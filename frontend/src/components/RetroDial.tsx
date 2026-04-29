import { useMemo, useRef, useEffect } from 'react'

interface RetroDialProps {
	label: string
	value: number
	min: number
	max: number
	step?: number
	onChange: (value: number) => void
	accent?: 'purple' | 'green' | 'orange'
	unit?: string
	formatValue?: (value: number) => string
}

const ACCENT_COLORS: Record<NonNullable<RetroDialProps['accent']>, string> = {
	purple: '#c14dff',
	green: '#8cff37',
	orange: '#ff9d3b',
}

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value))
}

// On mobile a "tap" can drift 15–20px — use a generous threshold so
// taps reliably trigger click-to-set rather than an accidental drag.
const DRAG_THRESHOLD = 20

export function RetroDial({
	label,
	value,
	min,
	max,
	step = 1,
	onChange,
	accent = 'purple',
	unit = '',
	formatValue,
}: RetroDialProps) {
	const dialRef = useRef<HTMLDivElement | null>(null)
	// Keep a ref for the latest onChange/value so the native listener closure stays fresh
	const stateRef = useRef({ value, onChange, min, max, step })
	stateRef.current = { value, onChange, min, max, step }

	const accentColor = ACCENT_COLORS[accent]
	const angle = useMemo(() => {
		const ratio = (value - min) / (max - min || 1)
		return -135 + ratio * 270
	}, [value, min, max])

	useEffect(() => {
		const el = dialRef.current
		if (!el) return

		function valueFromPoint(clientX: number, clientY: number): number {
			const { min, max, step, value } = stateRef.current
			const rect = el!.getBoundingClientRect()
			const cx = rect.left + rect.width / 2
			const cy = rect.top + rect.height / 2
			// atan2(x, -y) → 0° at top, positive clockwise
			const angleDeg = Math.atan2(clientX - cx, -(clientY - cy)) * (180 / Math.PI)
			const clamped = clamp(angleDeg, -135, 135)
			const ratio = (clamped + 135) / 270
			const raw = min + ratio * (max - min)
			const snapped = Math.round(raw / step) * step
			return Number(clamp(snapped, min, max).toFixed(2))
		}

		function onPointerDown(event: PointerEvent) {
			// Stop browser scroll/zoom — must be a non-passive listener to work on mobile
			event.preventDefault()
			el!.setPointerCapture(event.pointerId)
			const capturedId = event.pointerId

			let lastX = event.clientX
			let lastY = event.clientY
			let currentValue = stateRef.current.value
			let totalMovement = 0

			function onPointerMove(e: PointerEvent) {
				if (e.pointerId !== capturedId) return
				const { min, max, step, onChange } = stateRef.current
				const dx = e.clientX - lastX
				const dy = lastY - e.clientY // up = positive
				lastX = e.clientX
				lastY = e.clientY
				totalMovement += Math.abs(dx) + Math.abs(dy)
				const sensitivity = (max - min) / 200
				currentValue = clamp(currentValue + (dx + dy) * sensitivity, min, max)
				const snapped = Math.round(currentValue / step) * step
				onChange(Number(clamp(snapped, min, max).toFixed(2)))
			}

			function onPointerUp(e: PointerEvent) {
				if (e.pointerId !== capturedId) return
				el!.removeEventListener('pointermove', onPointerMove)
				el!.removeEventListener('pointerup', onPointerUp)
				el!.removeEventListener('pointercancel', onPointerUp)
				// Tap (barely moved) → jump directly to the tapped angle
				if (totalMovement < DRAG_THRESHOLD) {
					stateRef.current.onChange(valueFromPoint(e.clientX, e.clientY))
				}
			}

			el!.addEventListener('pointermove', onPointerMove)
			el!.addEventListener('pointerup', onPointerUp)
			el!.addEventListener('pointercancel', onPointerUp)
		}

		// { passive: false } is required so preventDefault() actually works on mobile
		el.addEventListener('pointerdown', onPointerDown, { passive: false })
		return () => {
			el.removeEventListener('pointerdown', onPointerDown)
		}
	}, []) // attach once — fresh values are read from stateRef

	return (
		<div className="retro-dial-wrap">
			<div
				ref={dialRef}
				className="retro-dial"
				role="slider"
				aria-label={label}
				aria-valuemin={min}
				aria-valuemax={max}
				aria-valuenow={value}
				tabIndex={0}
				onKeyDown={(event) => {
					if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
						event.preventDefault()
						onChange(clamp(value - step, min, max))
					}
					if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
						event.preventDefault()
						onChange(clamp(value + step, min, max))
					}
				}}
				style={{
					['--dial-accent' as string]: accentColor,
					// Prevent browser from claiming the touch for scroll/zoom
					touchAction: 'none',
					userSelect: 'none',
				}}
			>
				<div className="retro-dial-scale" />
				<div className="retro-dial-face">
					<div className="retro-dial-indicator" style={{ transform: `translateX(-50%) rotate(${angle}deg)` }} />
					<div className="retro-dial-cap" />
				</div>
			</div>
			<div className="retro-dial-label">{label}</div>
			<div className="retro-dial-value">{formatValue ? formatValue(value) : `${value}${unit}`}</div>
		</div>
	)
}

interface RetroPushButtonProps {
	label: string
	active: boolean
	onToggle: () => void
}

export function RetroPushButton({ label, active, onToggle }: RetroPushButtonProps) {
	return (
		<button type="button" className={`retro-push-button ${active ? 'is-active' : ''}`} onClick={onToggle}>
			<span className="retro-push-lamp" />
			<span>{label}</span>
		</button>
	)
}
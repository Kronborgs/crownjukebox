import { useMemo, useRef } from 'react'

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

// Minimum pixel movement before we treat a pointerdown as a drag (not a tap/click)
const DRAG_THRESHOLD = 6

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
	const accentColor = ACCENT_COLORS[accent]
	const angle = useMemo(() => {
		const ratio = (value - min) / (max - min || 1)
		return -135 + ratio * 270
	}, [value, min, max])

	// Convert a click/tap position to a dial value based on angle from center.
	// Dial arc: -135° (min) → +135° (max), measured clockwise from 12 o'clock.
	function valueFromPoint(clientX: number, clientY: number): number {
		const el = dialRef.current
		if (!el) return value
		const rect = el.getBoundingClientRect()
		const cx = rect.left + rect.width / 2
		const cy = rect.top + rect.height / 2
		const angleDeg = Math.atan2(clientX - cx, -(clientY - cy)) * (180 / Math.PI)
		const clamped = clamp(angleDeg, -135, 135)
		const ratio = (clamped + 135) / 270
		const raw = min + ratio * (max - min)
		const snapped = Math.round(raw / step) * step
		return Number(clamp(snapped, min, max).toFixed(2))
	}

	function startDrag(event: React.PointerEvent<HTMLDivElement>) {
		event.preventDefault()
		const el = event.currentTarget as HTMLElement
		el.setPointerCapture(event.pointerId)
		const capturedId = event.pointerId

		let lastX = event.clientX
		let lastY = event.clientY
		let currentValue = value
		let totalMovement = 0

		const handleMove = (e: PointerEvent) => {
			// Only handle the pointer that started this drag — prevents multi-touch interference
			if (e.pointerId !== capturedId) return
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

		const handleUp = (e: PointerEvent) => {
			if (e.pointerId !== capturedId) return
			// Attach on element (not window) so events are isolated per-knob
			el.removeEventListener('pointermove', handleMove)
			el.removeEventListener('pointerup', handleUp)
			// If the pointer barely moved it's a tap/click → jump to that angle
			if (totalMovement < DRAG_THRESHOLD) {
				onChange(valueFromPoint(e.clientX, e.clientY))
			}
		}

		// Attach to the element, not window — combined with setPointerCapture this
		// ensures each knob only reacts to its own pointer, even during multi-touch
		el.addEventListener('pointermove', handleMove)
		el.addEventListener('pointerup', handleUp)
	}

	return (
		<div className="retro-dial-wrap">
			<div
				ref={dialRef}
				className="retro-dial"
				onPointerDown={startDrag}
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
				style={{ ['--dial-accent' as string]: accentColor }}
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
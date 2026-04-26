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
}

const ACCENT_COLORS: Record<NonNullable<RetroDialProps['accent']>, string> = {
	purple: '#c14dff',
	green: '#8cff37',
	orange: '#ff9d3b',
}

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value))
}

export function RetroDial({
	label,
	value,
	min,
	max,
	step = 1,
	onChange,
	accent = 'purple',
	unit = '',
}: RetroDialProps) {
	const dialRef = useRef<HTMLDivElement | null>(null)
	const accentColor = ACCENT_COLORS[accent]
	const angle = useMemo(() => {
		const ratio = (value - min) / (max - min || 1)
		return -135 + ratio * 270
	}, [value, min, max])

	function updateFromPointer(clientX: number, clientY: number) {
		const rect = dialRef.current?.getBoundingClientRect()
		if (!rect) return
		const centerX = rect.left + rect.width / 2
		const centerY = rect.top + rect.height / 2
		const radians = Math.atan2(clientY - centerY, clientX - centerX)
		let degrees = radians * (180 / Math.PI) + 90
		if (degrees < -180) degrees += 360
		degrees = clamp(degrees, -135, 135)
		const ratio = (degrees + 135) / 270
		const rawValue = min + ratio * (max - min)
		const snapped = Math.round(rawValue / step) * step
		onChange(Number(clamp(snapped, min, max).toFixed(2)))
	}

	function startDrag(event: React.PointerEvent<HTMLDivElement>) {
		event.preventDefault()
		updateFromPointer(event.clientX, event.clientY)

		const handleMove = (moveEvent: PointerEvent) => updateFromPointer(moveEvent.clientX, moveEvent.clientY)
		const handleUp = () => {
			window.removeEventListener('pointermove', handleMove)
			window.removeEventListener('pointerup', handleUp)
		}

		window.addEventListener('pointermove', handleMove)
		window.addEventListener('pointerup', handleUp)
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
			<div className="retro-dial-value">{value}{unit}</div>
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
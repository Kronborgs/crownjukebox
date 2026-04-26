import { useState, useEffect } from 'react'
import { roomApi, Room } from '@/api/client'
import { useSession } from '@/hooks/useSession'

interface Props {
  onRoomSelected: (roomId: string) => void
}

export function RoomSelector({ onRoomSelected }: Props) {
  const { user, setRoom } = useSession()
  const [rooms, setRooms] = useState<Room[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    roomApi.list()
      .then(list => {
        setRooms(list)
        // If there's only one room, auto-select it
        if (list.length === 1) {
          setRoom(list[0].id)
          onRoomSelected(list[0].id)
        }
      })
      .catch(err => setError((err as Error).message))
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelect = (room: Room) => {
    setRoom(room.id)
    onRoomSelected(room.id)
  }

  return (
    <div className="min-h-screen bg-[#0d0520] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="text-5xl mb-2">♛</div>
          <h1 className="text-xl font-bold tracking-widest text-purple-100 uppercase">CrownJukebox</h1>
          <p className="text-purple-400 text-sm mt-1">
            Hej {user?.display_name} — vælg et rum
          </p>
        </div>

        {loading && (
          <div className="text-center text-purple-400 py-8">Indlæser rum...</div>
        )}

        {error && (
          <div className="p-3 rounded-lg bg-red-900/40 border border-red-700/50 text-red-300 text-sm text-center mb-4">
            {error}
          </div>
        )}

        {!loading && rooms.length === 0 && !error && (
          <div className="text-center text-purple-400 py-8">Ingen rum fundet.</div>
        )}

        <div className="space-y-3">
          {rooms.map(room => (
            <button
              key={room.id}
              onClick={() => handleSelect(room)}
              className="w-full bg-[#1a0a30] border border-purple-900/40 rounded-xl p-5 text-left
                         hover:border-purple-500/60 hover:bg-[#200d3a] transition-all group"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-purple-100 font-semibold text-lg group-hover:text-white">
                    {room.name}
                  </div>
                  {room.id === 'default' && (
                    <div className="text-purple-500 text-xs mt-0.5">Hoved-scene</div>
                  )}
                </div>
                <div className="text-purple-400 group-hover:text-purple-200 text-2xl">→</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

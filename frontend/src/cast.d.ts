/**
 * Minimal type declarations for the Google Cast Sender SDK (CAF).
 * Only covers the subset used by useCast.ts.
 * Full types: https://developers.google.com/cast/docs/reference/web_sender
 */

declare namespace cast {
  namespace framework {
    const CastContext: {
      getInstance(): CastContextInstance
    }

    interface CastContextInstance {
      setOptions(options: CastOptions): void
      requestSession(): Promise<void>
      getCurrentSession(): CastSession | null
      addEventListener(type: string, handler: (ev: SessionStateEventData) => void): void
    }

    interface CastOptions {
      receiverApplicationId: string
      autoJoinPolicy: string
    }

    interface CastSession {
      loadMedia(request: chrome.cast.media.LoadRequest): Promise<void>
      endSession(stopCasting: boolean): void
    }

    interface SessionStateEventData {
      sessionState: string
    }

    const SessionState: {
      SESSION_STARTED: string
      SESSION_RESUMED: string
      SESSION_ENDED: string
    }

    const CastContextEventType: {
      SESSION_STATE_CHANGED: string
    }
  }
}

declare namespace chrome {
  namespace cast {
    const AutoJoinPolicy: { ORIGIN_SCOPED: string }

    class Image {
      constructor(url: string)
    }

    namespace media {
      class MediaInfo {
        constructor(contentId: string, contentType: string)
        metadata: MusicTrackMediaMetadata
      }

      class LoadRequest {
        constructor(mediaInfo: MediaInfo)
      }

      class MusicTrackMediaMetadata {
        title: string
        artist: string
        images: chrome.cast.Image[]
      }
    }
  }
}

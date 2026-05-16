//go:build !linux

package api

type diskStats struct {
	TotalBytes int64
	FreeBytes  int64
	UsedBytes  int64
}

func getDiskStats(_ string) diskStats { return diskStats{} }

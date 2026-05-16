//go:build linux

package api

import "syscall"

type diskStats struct {
	TotalBytes int64
	FreeBytes  int64
	UsedBytes  int64
}

func getDiskStats(path string) diskStats {
	var s syscall.Statfs_t
	if err := syscall.Statfs(path, &s); err != nil {
		return diskStats{}
	}
	total := int64(s.Blocks) * s.Bsize
	free := int64(s.Bfree) * s.Bsize
	return diskStats{
		TotalBytes: total,
		FreeBytes:  free,
		UsedBytes:  total - free,
	}
}

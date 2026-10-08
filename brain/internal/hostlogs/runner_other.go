//go:build !linux && !darwin

package hostlogs

func Run(dir, command string) int { return 1 }

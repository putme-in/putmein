package deploy

import (
	"context"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"brain/server/internal/agent"
)

// Stage a fresh host release so a build cannot rewrite the running release.
// Special files and symlinks escaping the application tree are rejected.
func stageHostSource(ctx context.Context, source, handle string) (string, error) {
	return stageHostSourceAt(ctx, source, handle, agent.GetDeploymentsDir())
}

func stageHostSourceAt(ctx context.Context, source, handle, base string) (string, error) {
	return stageSourceAt(ctx, source, handle, base, ".host-releases")
}

func stageSourceAt(ctx context.Context, source, handle, base, kind string) (string, error) {
	root := filepath.Join(base, kind, strings.TrimPrefix(handle, hostPrefix))
	if relative, err := filepath.Rel(source, root); err != nil || relative == "." || (!strings.HasPrefix(relative, ".."+string(filepath.Separator)) && relative != "..") {
		return "", fmt.Errorf("select an application directory that does not contain the host deployment directory")
	}
	if err := os.MkdirAll(root, 0700); err != nil {
		return "", err
	}
	destination, err := os.MkdirTemp(root, "release-")
	if err != nil {
		return "", err
	}
	var total int64
	count := 0
	err = filepath.WalkDir(source, func(current string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		relative, err := filepath.Rel(source, current)
		if err != nil {
			return err
		}
		if entry.Name() == ".git" {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		count++
		if count > 100000 {
			return fmt.Errorf("source contains more than 100,000 entries")
		}
		target := filepath.Join(destination, relative)
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return os.MkdirAll(target, info.Mode().Perm()|0700)
		}
		if info.Mode()&os.ModeSymlink != 0 {
			resolved, err := filepath.EvalSymlinks(current)
			if err != nil {
				return err
			}
			inside, err := filepath.Rel(source, resolved)
			if err != nil || inside == ".." || strings.HasPrefix(inside, ".."+string(filepath.Separator)) || filepath.IsAbs(inside) {
				return fmt.Errorf("source symlink %s escapes the application directory", relative)
			}
			link, err := filepath.Rel(filepath.Dir(target), filepath.Join(destination, inside))
			if err != nil {
				return err
			}
			return os.Symlink(link, target)
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("unsupported special file in source: %s", relative)
		}
		if total+info.Size() > 2*1024*1024*1024 {
			return fmt.Errorf("expanded host source exceeds 2 GiB; exclude generated files before deploying")
		}
		input, err := os.Open(current)
		if err != nil {
			return err
		}
		defer input.Close()
		output, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, info.Mode().Perm())
		if err != nil {
			return err
		}
		copied, copyErr := io.Copy(output, io.LimitReader(input, 2*1024*1024*1024-total+1))
		total += copied
		if total > 2*1024*1024*1024 {
			copyErr = fmt.Errorf("expanded host source exceeds 2 GiB")
		}
		closeErr := output.Close()
		if copyErr != nil {
			return copyErr
		}
		return closeErr
	})
	if err != nil {
		_ = os.RemoveAll(destination)
		return "", err
	}
	return destination, nil
}

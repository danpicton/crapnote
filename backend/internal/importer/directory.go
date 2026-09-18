package importer

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
)

// checkDirectory bounds allocations made by yeka/zip.NewReader. Current exports
// within our upload/entry limits need neither ZIP64 nor multi-disk ZIPs. Scan
// fixed-size headers without allocating entry names/comments, and verify the
// actual count, not just the untrusted end-of-directory count.
func checkDirectory(source io.ReaderAt, size int64, maxEntries int) error {
	const endSize = 22
	if size < endSize {
		return errors.New("missing ZIP central directory")
	}
	tail := make([]byte, min(size, endSize+65535))
	if _, err := source.ReadAt(tail, size-int64(len(tail))); err != nil {
		return err
	}
	le := binary.LittleEndian
	for i := len(tail) - endSize; i >= 0; i-- {
		if le.Uint32(tail[i:]) != 0x06054b50 || i+endSize+int(le.Uint16(tail[i+20:])) > len(tail) {
			continue
		}
		// Match the library's *first* eligible record. Never skip a shadow
		// record with trailing bytes and accidentally check a different one.
		if i+endSize+int(le.Uint16(tail[i+20:])) != len(tail) {
			return errors.New("unsupported trailing ZIP data")
		}
		end := tail[i:]
		count := int(le.Uint16(end[10:]))
		if count > maxEntries {
			return fmt.Errorf("archive has too many entries (maximum %d)", maxEntries)
		}
		if le.Uint16(end[4:]) != 0 || le.Uint16(end[6:]) != 0 || int(le.Uint16(end[8:])) != count || count == 65535 {
			return errors.New("multi-disk and ZIP64 archives are unsupported")
		}
		length := int64(le.Uint32(end[12:]))
		offset := int64(le.Uint32(end[16:]))
		endOffset := size - int64(len(tail)) + int64(i)
		// yeka follows any ZIP64 locator immediately before the end record,
		// even without sentinel counts. Reject it before it can override the
		// directory we checked (including locators hidden in entry comments).
		if endOffset >= 20 {
			var locator [4]byte
			if _, err := source.ReadAt(locator[:], endOffset-20); err != nil {
				return err
			}
			if le.Uint32(locator[:]) == 0x07064b50 {
				return errors.New("ZIP64 archives are unsupported")
			}
		}
		// Export names/extras are small. Cap all directory metadata at 2 MiB
		// even when a crafted archive advertises only a handful of entries.
		if length > 2<<20 || offset+length != endOffset {
			return errors.New("unsupported or oversized ZIP central directory")
		}
		var header [46]byte
		position := offset
		for n := 0; position < endOffset; n++ {
			if n >= count || position+int64(len(header)) > endOffset {
				return errors.New("invalid ZIP central directory count")
			}
			if _, err := source.ReadAt(header[:], position); err != nil {
				return err
			}
			if le.Uint32(header[:]) != 0x02014b50 {
				return errors.New("invalid ZIP central directory entry")
			}
			position += int64(len(header)) + int64(le.Uint16(header[28:])) + int64(le.Uint16(header[30:])) + int64(le.Uint16(header[32:]))
			if position > endOffset || position == endOffset && n+1 != count {
				return errors.New("invalid ZIP central directory size or count")
			}
		}
		if length == 0 && count != 0 {
			return errors.New("invalid ZIP central directory count")
		}
		return nil
	}
	return errors.New("missing ZIP central directory")
}

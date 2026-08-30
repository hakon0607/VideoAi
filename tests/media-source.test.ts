/**
 * `storage_path` is a tiny union type spelled as a string prefix, and every
 * part of the app branches on it. Getting the classification wrong means the
 * server tries to sign a file that only exists in a browser.
 */
import { describe, expect, it } from 'vitest';
import { originOf } from '@/lib/media/media-source';

describe('where a file lives', () => {
  it('reads the prefix', () => {
    expect(originOf('local:6f1c…')).toBe('local');
    expect(originOf('sfx:whoosh')).toBe('generated');
    expect(originOf('music:lofi_chill')).toBe('generated');
    expect(originOf('library/music/track.mp3')).toBe('cloud');
    expect(originOf('library:music/track.mp3')).toBe('library');
    expect(originOf('user/abc/projects/def/media/ghi.mp4')).toBe('cloud');
  });

  it('treats anything without a known prefix as a bucket path', () => {
    // The server signs exactly the paths this returns "cloud" for, so a false
    // positive here is a request for a file the bucket has never seen.
    expect(originOf('')).toBe('cloud');
    expect(originOf('weird name with spaces.mp4')).toBe('cloud');
  });
});

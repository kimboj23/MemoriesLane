

# ============================================================================
# MEMORIESLANE_CHROME_PROFILE_LOCK -- appended to util.py at image build
# ============================================================================
# Fixes two related failures, both caused by Chromium's per-profile mutex
# (`SingletonLock -> "<hostname>-<pid>"` inside CHROME_USER_DATA_DIR).
#
# 1. A lock left by a DEAD process blocks Chrome forever. Killing the
#    container never lets Chromium remove its lock, and the replacement
#    container has a different hostname, so Chrome refuses to start at all
#    ("The profile appears to be in use ... on another computer"). Every
#    Chrome extractor then fails while wget/mercury/media keep working, so
#    captures look fine but silently produce no title, no screenshot and no
#    singlefile.html. Observed 2026-08-26 from a lock six days stale.
#
# 2. A lock held by a LIVE process makes `pdf` hang for the full TIMEOUT.
#    `singlefile` runs Chrome immediately before `pdf` and its browser
#    lingers a moment after the CLI returns. Chrome does NOT abort when the
#    holder is alive on the same host -- it tries to hand the URL to that
#    instance and waits, which never completes under --print-to-pdf. By the
#    time `screenshot`/`dom` run the browser has exited, which is why they
#    succeed 1s after `pdf` fails at 180s, and why this looked for a long
#    time like a pdf-specific or page-specific bug. It is neither: with the
#    profile free, ArchiveBox's exact pdf command renders vnexpress.net in
#    10s.
#
# Why this started 2026-08-12: before then CHROME_USER_DATA_DIR was unset, so
# singlefile's puppeteer used its own temp profile and never collided, and
# ArchiveBox's own chrome_cleanup() -- which only ever looks in
# /home/archivebox/.config/chromium -- was still looking in the right place.
# Setting CHROME_USER_DATA_DIR moved the profile but not that cleanup path,
# so upstream's self-healing silently stopped working. Every pdf capture has
# failed since that day; the last success was 2026-08-05.
#
# Deliberately does NOT just delete the lock: that mutex is what stops two
# Chromes corrupting one profile, and captures now run in background threads
# so genuine concurrency is possible. A LIVE holder is waited for; only a
# provably dead one (different hostname, or a pid that no longer exists) is
# removed.
import os as _ml_os
import socket as _ml_socket
import time as _ml_time

_ML_SINGLETONS = ('SingletonLock', 'SingletonSocket', 'SingletonCookie')


def _ml_profile_dirs():
    from .config import CHROME_USER_DATA_DIR
    dirs = []
    if CHROME_USER_DATA_DIR:
        dirs.append(str(CHROME_USER_DATA_DIR))
    # Upstream's hardcoded default, still cleaned so behaviour is a superset
    # of stock ArchiveBox rather than a replacement for it.
    dirs.append('/home/archivebox/.config/chromium')
    return dirs


def _ml_lock_holder_alive(lock_path):
    """True only if a process on THIS host still holds the profile."""
    try:
        target = _ml_os.readlink(lock_path)
    except OSError:
        return False                      # not a symlink -> junk, treat as dead
    host, _, pid = target.rpartition('-')
    if host != _ml_socket.gethostname():
        return False                      # written by a now-dead container
    try:
        _ml_os.kill(int(pid), 0)          # signal 0 = liveness probe only
        return True
    except (ValueError, ProcessLookupError):
        return False
    except PermissionError:
        return True                       # exists but not ours to signal


def _ml_release_chrome_profile(wait_secs=45):
    """Make the Chrome profile safe to launch against.

    Waits for a live holder to exit (that's the lingering-singlefile case),
    then removes the lock only if nothing is actually holding it.
    """
    for d in _ml_profile_dirs():
        lock = _ml_os.path.join(d, 'SingletonLock')
        deadline = _ml_time.time() + wait_secs
        while (_ml_os.path.lexists(lock) and _ml_lock_holder_alive(lock)
               and _ml_time.time() < deadline):
            _ml_time.sleep(0.5)
        if _ml_os.path.lexists(lock) and not _ml_lock_holder_alive(lock):
            for name in _ML_SINGLETONS:
                try:
                    _ml_os.remove(_ml_os.path.join(d, name))
                except OSError:
                    pass


_ml_orig_chrome_args = chrome_args


def chrome_args(**options):
    # Every Chrome-backed extractor builds its command line here, so this is
    # the one place that reliably runs just before a browser launch.
    _ml_release_chrome_profile()
    return _ml_orig_chrome_args(**options)


def chrome_cleanup():
    # Upstream's version only removed the lock from the hardcoded default
    # profile dir, so it was a no-op once CHROME_USER_DATA_DIR was set.
    # No waiting here: this runs on the failure path, where the point is to
    # not leave a corpse behind for the next extractor.
    _ml_release_chrome_profile(wait_secs=0)

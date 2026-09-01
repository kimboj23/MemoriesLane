

# ============================================================================
# MEMORIESLANE_SINGLEFILE_SERIALIZE -- appended to extractors/singlefile.py
# ============================================================================
# Serialise SingleFile across concurrent captures.
#
# Captures run on background threads now (see core/ml_background.py), so two
# can overlap -- a second Add from the extension, or a bulk Re-Snapshot. The
# other Chrome extractors survive that: they launch chromium immediately after
# chrome_args(), which waits for the profile to be free (util.py's
# _ml_release_chrome_profile). SingleFile does not -- it hands the browser args
# to its node CLI, which launches chromium later, well outside that window. So
# under concurrency it loses the race for its profile and fails.
#
# Measured with two simultaneous captures before this patch: 11/11 extractors
# on one, 11/12 on the other, the single failure being singlefile. (Raw
# chromium in the same situation aborts outright with exit=21, so the
# chrome_args wait is doing real work for the other extractors.)
#
# A whole-profile copy per capture would also fix it but costs ~100MB of I/O
# each time; taking a lock is free and captures are already minutes long, so
# the second one simply waits its turn. Bounded by the extractor's own timeout
# so a wedged holder can never block a capture indefinitely -- if the lock
# can't be had in time we proceed anyway and accept the old race, which is
# strictly no worse than not having this patch.
import fcntl as _ml_fcntl
import os as _ml_sf_os
import time as _ml_sf_time

_ML_SF_LOCKFILE = _ml_sf_os.environ.get('SINGLEFILE_LOCKFILE', '/tmp/archivebox_singlefile.lock')

_ml_orig_save_singlefile = save_singlefile


def save_singlefile(link, out_dir=None, timeout=TIMEOUT):
    fd = _ml_sf_os.open(_ML_SF_LOCKFILE, _ml_sf_os.O_CREAT | _ml_sf_os.O_RDWR, 0o666)
    holding = False
    deadline = _ml_sf_time.time() + max(int(timeout or 0), 1)
    try:
        while _ml_sf_time.time() < deadline:
            try:
                _ml_fcntl.flock(fd, _ml_fcntl.LOCK_EX | _ml_fcntl.LOCK_NB)
                holding = True
                break
            except OSError:
                _ml_sf_time.sleep(0.5)      # another capture's singlefile is running
        if not holding:
            print('    ! singlefile: proceeding without the serialisation lock (waited {}s)'.format(timeout))
        return _ml_orig_save_singlefile(link, out_dir=out_dir, timeout=timeout)
    finally:
        if holding:
            try:
                _ml_fcntl.flock(fd, _ml_fcntl.LOCK_UN)
            except OSError:
                pass
        try:
            _ml_sf_os.close(fd)
        except OSError:
            pass

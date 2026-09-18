# systemd units for the nightly ArchiveBox backup

The VPS image ships no cron, so the backup runs from a systemd timer. Install
on a (re)built VPS with:

```bash
sudo cp ~/MemoriesLane/backup/systemd/archivebox-backup.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now archivebox-backup.timer
systemctl list-timers archivebox-backup.timer     # shows the next run (03:00 UTC nightly)
```

Logs go to `~/backups/archivebox-backup.log`. The service is expected to show
as *failed* until `backup/b2.env` and `backup/secrets.passphrase` exist — that
is deliberate, so a missing off-box copy is never silent.

FROM python:3.12-alpine
# rclone from Alpine's own repo: pinned by the base image tag, no curl|sh.
RUN apk add --no-cache rclone
COPY sync.sh build_index.py /app/
RUN chmod +x /app/sync.sh
CMD ["/app/sync.sh"]

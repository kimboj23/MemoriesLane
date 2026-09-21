FROM alpine:3.20
# Tor from Alpine's repo; runs as the package's unprivileged `tor` user.
RUN apk add --no-cache tor
COPY torrc /etc/tor/torrc
USER tor
CMD ["tor", "-f", "/etc/tor/torrc"]

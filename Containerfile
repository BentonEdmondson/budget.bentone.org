FROM debian:trixie@sha256:d07d1b51c39f51188e60be9b64e6bf769fa94e187f092bc32b91305cfa34ba5a

RUN apt-get update
RUN apt-get install -y curl
RUN curl -fsSL https://opencode.ai/install | bash
ENTRYPOINT [ "/root/.opencode/bin/opencode" ]

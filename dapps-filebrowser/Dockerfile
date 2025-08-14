FROM filebrowser/filebrowser:v2.35.0

USER root

ARG FILEBROWSER_BASE_URL
ARG FILEBROWSER_TITLE
WORKDIR /

COPY filebrowser.json /.filebrowser.json
COPY branding /branding

RUN sed -i "s|FILEBROWSER_BASE_URL|${FILEBROWSER_BASE_URL}|g" /.filebrowser.json

RUN filebrowser config init
RUN filebrowser users add student 'dummypassworddummypassword'
RUN filebrowser config set --branding.name "${FILEBROWSER_TITLE}" --branding.files "/branding" --branding.disableExternal --branding.theme "dark"
RUN filebrowser config set --auth.method=noauth

RUN chown 1000:1000 /.filebrowser.json /filebrowser.db
USER 1000

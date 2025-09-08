FROM filebrowser/filebrowser:v2.42.5

USER root

ARG FILEBROWSER_BASE_URL
ARG FILEBROWSER_TITLE
WORKDIR /

COPY settings.json /config/settings.json
COPY branding /branding

RUN sed -i "s|FILEBROWSER_BASE_URL|${FILEBROWSER_BASE_URL}|g" /config/settings.json

RUN filebrowser config init
RUN filebrowser users add student 'dummypassworddummypassword'
RUN filebrowser config set --branding.name "${FILEBROWSER_TITLE}" --branding.files "/branding" --branding.disableExternal --branding.theme "dark"
RUN filebrowser config set --auth.method=noauth

RUN chown 1000:1000 /config/settings.json /filebrowser.db
USER 1000
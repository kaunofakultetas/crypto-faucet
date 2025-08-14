FROM python:3.12.4

WORKDIR /app


# Dependencies
RUN  apt-get update && \
     apt-get -y install nano procps && \
     rm -rf /var/lib/apt/lists/*


# Setup Backend
COPY ./requirements.txt /app
RUN pip install --no-cache-dir -r requirements.txt


EXPOSE 8000
CMD ["python3", "-u", "main.py"]
# CMD ["sleep", "infinity"]
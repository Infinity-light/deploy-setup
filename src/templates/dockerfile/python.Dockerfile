FROM python:{{PYTHON_VERSION}}-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE {{APP_PORT}}

CMD [{{START_CMD_DOCKER}}]

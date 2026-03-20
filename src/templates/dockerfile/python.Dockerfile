FROM python:{{PYTHON_VERSION}}-slim

WORKDIR /app

{{#IF MIRROR_PIP}}
RUN pip config set global.index-url https://{{MIRROR_PIP}} && pip config set install.trusted-host {{MIRROR_PIP}}
{{/IF}}

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE {{APP_PORT}}

CMD [{{START_CMD_DOCKER}}]

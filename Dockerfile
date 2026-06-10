FROM python:3.12-slim

WORKDIR /app

COPY pyproject.toml README.md ./
COPY southpay_mcp ./southpay_mcp

RUN pip install --no-cache-dir .

ENV MCP_TRANSPORT=http \
    MCP_HOST=0.0.0.0

EXPOSE 8080

CMD ["southpay-mcp"]

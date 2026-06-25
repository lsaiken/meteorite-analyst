.PHONY: test, format


format:
	ruff format

test:
	pytest -v
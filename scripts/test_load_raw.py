from unittest import mock
import os
import pytest
import tempfile


@pytest.fixture(scope="session", autouse=True)
def fake_environment_variables():
    with mock.patch.dict(os.environ, {"DATABASE_URL": "fake_url"}) as envvars:
        yield envvars


def test_missing_columns(fake_environment_variables):
    # Import module inside the function because DATABASE_URL is a module level environment variable
    from .load_raw import load_raw_data

    tmp_file = tempfile.NamedTemporaryFile(suffix=".csv")

    tmp_file.write(b"name,id,nametype,reclass")

    with pytest.raises(ValueError):
        load_raw_data(tmp_file.name)

    tmp_file.close()

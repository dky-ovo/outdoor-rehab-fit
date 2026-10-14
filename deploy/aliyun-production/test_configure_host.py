"""Check public configuration templates without reading or creating secrets."""

import importlib.util
from pathlib import Path
import unittest


HERE = Path(__file__).absolute().parent
WORKSPACE = HERE.parent.parent
SPEC = importlib.util.spec_from_file_location("configure_host", HERE / "configure-host.py")
CONFIGURE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CONFIGURE)


def public_values(text):
    return dict(line.split("=", 1) for line in text.splitlines()
                if line and not line.startswith("#"))


class PublicConfigurationTests(unittest.TestCase):
    def test_provisioning_accepts_current_production_template(self):
        template = (HERE / "env.example").read_text(encoding="utf-8")
        values = CONFIGURE.environment_values(Path("/opt/outdoor-fit/releases/config-test"),
                                               "config-test@example.invalid")
        rendered = CONFIGURE.render_environment(template, values)
        self.assertEqual(public_values(rendered.decode("utf-8")), values)

    def test_bailian_defaults_match_server_and_production_examples(self):
        defaults = CONFIGURE.environment_values(Path("/opt/outdoor-fit/releases/config-test"),
                                                 "config-test@example.invalid")
        expected = {
            "BAILIAN_FAQ_ENABLED": "false",
            "BAILIAN_MODEL_ID": "qwen3-14b-1f1a8952705b",
            "BAILIAN_BASE_URL": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
            "DASHSCOPE_API_KEY": "",
        }
        for path in (HERE / "env.example", WORKSPACE / "server/.env.example"):
            with self.subTest(template=str(path.relative_to(WORKSPACE))):
                example = public_values(path.read_text(encoding="utf-8"))
                self.assertEqual({key: example.get(key) for key in expected}, expected)
        self.assertEqual({key: defaults.get(key) for key in expected}, expected)


if __name__ == "__main__":
    unittest.main()

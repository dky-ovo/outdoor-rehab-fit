#!/usr/bin/env python3
"""Prepare exclusive private production configuration; never deploy or import."""

import argparse
import getpass
import os
from pathlib import Path
import re
import ssl
import stat
import sys
import warnings


BASE = Path("/opt/outdoor-fit/production")
SECRETS = BASE / "secrets"
CA_FILE = BASE / "config/rds-ca-chain.pem"
TARGETS = ("jwt-secret", "mysql-password", "production.env")
DEFAULT_JWT = "development-only-secret-change-before-production"
MAX_INPUT_BYTES = 65536


class ConfigurationError(Exception):
    pass


def require(condition, code):
    if not condition:
        raise ConfigurationError(code)


def absolute_path(value):
    # Paths enter an unquoted Compose env file. No variable expansion, spaces,
    # quotes, newlines, backslashes or parent-directory components are accepted.
    require(isinstance(value, str) and re.fullmatch(r"/[A-Za-z0-9._/-]+", value),
            "CONFIGURE_ABSOLUTE_SAFE_PATH_REQUIRED")
    require(all(part not in ("", ".", "..") for part in value.split("/")[1:]),
            "CONFIGURE_ABSOLUTE_SAFE_PATH_REQUIRED")
    return Path(value)


def checked_path(path, directory=False):
    # Check every existing component rather than resolving through symlinks.
    for component in reversed((path, *path.parents)):
        info = component.lstat()
        require(not stat.S_ISLNK(info.st_mode), "CONFIGURE_SYMLINK_REFUSED")
        if component != path or directory:
            require(stat.S_ISDIR(info.st_mode), "CONFIGURE_DIRECTORY_REQUIRED")
    info = path.lstat()
    if not directory:
        require(stat.S_ISREG(info.st_mode), "CONFIGURE_REGULAR_FILE_REQUIRED")
    return info


def identity(info):
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns


def read_regular(path, maximum=MAX_INPUT_BYTES):
    before = checked_path(path)
    require(0 < before.st_size <= maximum, "CONFIGURE_FILE_SIZE_INVALID")
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        require(identity(os.fstat(descriptor)) == identity(before), "CONFIGURE_SOURCE_CHANGED")
        with os.fdopen(descriptor, "rb", closefd=False) as stream:
            data = stream.read(maximum + 1)
        require(len(data) <= maximum and identity(os.fstat(descriptor)) == identity(before),
                "CONFIGURE_SOURCE_CHANGED")
        require(identity(path.lstat()) == identity(before), "CONFIGURE_SOURCE_CHANGED")
        return data, before
    finally:
        os.close(descriptor)


def runtime_access(info, required):
    if info.st_uid == 1000:
        permission = (info.st_mode >> 6) & 7
    elif info.st_gid == 1000:
        permission = (info.st_mode >> 3) & 7
    else:
        permission = info.st_mode & 7
    return permission & required == required


def preflight(release):
    for relative in ("", "config", "secrets", "releases", "state", "web",
                     "state/equipment-images", "state/media-library", "state/media-seed",
                     "state/caddy-data", "state/caddy-config"):
        checked_path(BASE / relative, directory=True)
    private = SECRETS.lstat()
    require(private.st_uid == 0 and private.st_gid == 0
            and stat.S_IMODE(private.st_mode) == 0o700,
            "CONFIGURE_SECRETS_ROOT_0700_REQUIRED")
    for relative in ("equipment-images", "media-library", "caddy-data", "caddy-config"):
        require(runtime_access((BASE / "state" / relative).lstat(), 7),
                "CONFIGURE_RUNTIME_DIRECTORY_PERMISSIONS_INVALID")
    require(runtime_access((BASE / "state/media-seed").lstat(), 5),
            "CONFIGURE_RUNTIME_DIRECTORY_PERMISSIONS_INVALID")
    checked_path(release, directory=True)
    require(runtime_access(checked_path(release / "web", directory=True), 5)
            and runtime_access(checked_path(release / "web/index.html"), 4),
            "CONFIGURE_WEB_UNREADABLE")
    ca_bytes, ca_info = read_regular(CA_FILE, 1024 * 1024)
    require(runtime_access(ca_info, 4) and b"PRIVATE KEY" not in ca_bytes,
            "CONFIGURE_CA_INVALID")
    try:
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        context.load_verify_locations(cadata=ca_bytes.decode("ascii"))
    except (UnicodeError, ssl.SSLError, ValueError):
        raise ConfigurationError("CONFIGURE_CA_INVALID") from None
    return private


def validated_jwt(path):
    data, info = read_regular(path)
    try:
        value = data.decode("utf-8", errors="strict")
    except UnicodeError:
        raise ConfigurationError("CONFIGURE_JWT_SOURCE_INVALID") from None
    require(len(value) >= 32 and value != DEFAULT_JWT
            and not any(character in value for character in ("\r", "\n", "\0")),
            "CONFIGURE_JWT_SOURCE_INVALID")
    # Preserve every byte; never strip a newline, trim whitespace or generate a
    # replacement key. A malformed export must be corrected at its source.
    return data, info


def environment_values(release, email):
    return {
        "RELEASE_TAG": "20260924-v1",
        "CADDY_IMAGE": "caddy:2.11.4-alpine",
        "ACME_EMAIL": email,
        "HTTP_BIND": "0.0.0.0:80",
        "HTTPS_BIND": "0.0.0.0:443",
        "JWT_SECRET_FILE": str(SECRETS / "jwt-secret"),
        "MYSQL_HOST": "rm-3nsog7t39ggxq6qkv.rwlb.cnhk.rds.aliyuncs.com",
        "MYSQL_PORT": "3306",
        "MYSQL_USER": "outdoor_fit_app",
        "MYSQL_PASSWORD_FILE": str(SECRETS / "mysql-password"),
        "MYSQL_DATABASE": "outdoor_fit_prod",
        "RDS_CA_FILE": str(CA_FILE),
        "EQUIPMENT_IMAGES_DIR": str(BASE / "state/equipment-images"),
        "MEDIA_LIBRARY_DIR": str(BASE / "state/media-library"),
        "MEDIA_SEED_DIR": str(BASE / "state/media-seed"),
        "ADMIN_WEB_DIR": str(release / "web"),
        "CADDY_DATA_DIR": str(BASE / "state/caddy-data"),
        "CADDY_CONFIG_DIR": str(BASE / "state/caddy-config"),
        "SMS_MODE": "disabled",
        "TWILIO_ACCOUNT_SID": "",
        "TWILIO_API_KEY_SID": "",
        "TWILIO_API_KEY_SECRET": "",
        "TWILIO_VERIFY_SERVICE_SID": "",
        # Initial provisioning only: activation and the API key are supplied later.
        "BAILIAN_FAQ_ENABLED": "false",
        "BAILIAN_MODEL_ID": "qwen3-14b-1f1a8952705b",
        "BAILIAN_BASE_URL": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        "DASHSCOPE_API_KEY": "",
    }


def render_environment(template, values):
    lines, seen = [], set()
    for line in template.splitlines():
        if not line or line.startswith("#"):
            lines.append(line)
            continue
        match = re.fullmatch(r"([A-Z][A-Z0-9_]*)=(.*)", line)
        require(match is not None, "CONFIGURE_ENV_TEMPLATE_INVALID")
        key = match.group(1)
        require(key in values and key not in seen, "CONFIGURE_ENV_TEMPLATE_INVALID")
        seen.add(key)
        lines.append(key + "=" + values[key])
    require(seen == values.keys(), "CONFIGURE_ENV_TEMPLATE_INVALID")
    return ("\n".join(lines) + "\n").encode("utf-8")


def require_absent(directory_fd):
    for name in TARGETS:
        try:
            os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
        except FileNotFoundError:
            continue
        raise ConfigurationError("CONFIGURE_TARGET_ALREADY_EXISTS")


def write_exclusive(directory_fd, files):
    created = []
    try:
        for name, data in files:
            descriptor = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL
                                 | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600, dir_fd=directory_fd)
            try:
                info = os.fstat(descriptor)
                created.append((name, info.st_dev, info.st_ino))
                with os.fdopen(descriptor, "wb", closefd=False) as stream:
                    stream.write(data)
                    stream.flush()
                os.fchown(descriptor, 1000, 1000)
                os.fchmod(descriptor, 0o400)
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
        os.fsync(directory_fd)
    except BaseException:
        # Remove only files created by this invocation, and only if their inode
        # still matches. Existing/replaced files are never overwritten/deleted.
        for name, device, inode in reversed(created):
            try:
                info = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
                if (info.st_dev, info.st_ino) == (device, inode):
                    os.unlink(name, dir_fd=directory_fd)
            except OSError:
                pass
        raise


def configure(args):
    require(hasattr(os, "geteuid") and os.geteuid() == 0, "CONFIGURE_REQUIRES_ROOT")
    os.umask(0o077)
    release, jwt_source = absolute_path(args.release), absolute_path(args.jwt_source)
    secrets_info = preflight(release)
    jwt_bytes, jwt_info = validated_jwt(jwt_source)
    template_bytes, _ = read_regular(release / "deploy/aliyun-production/env.example")
    try:
        template = template_bytes.decode("utf-8", errors="strict")
    except UnicodeError:
        raise ConfigurationError("CONFIGURE_ENV_TEMPLATE_INVALID") from None
    # Check template shape before requesting secrets from the operator.
    render_environment(template, environment_values(release, "check@example.invalid"))
    directory_fd = os.open(SECRETS, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        opened = os.fstat(directory_fd)
        require((opened.st_dev, opened.st_ino) == (secrets_info.st_dev, secrets_info.st_ino),
                "CONFIGURE_DIRECTORY_CHANGED")
        require_absent(directory_fd)
        require(sys.stdin.isatty() and sys.stderr.isatty(), "CONFIGURE_INTERACTIVE_TERMINAL_REQUIRED")
        with warnings.catch_warnings():
            warnings.simplefilter("error", getpass.GetPassWarning)
            password = getpass.getpass("outdoor_fit_app password: ")
            confirmation = getpass.getpass("Confirm outdoor_fit_app password: ")
        require(password == confirmation, "CONFIGURE_PASSWORD_MISMATCH")
        require(password and not any(character in password for character in ("\r", "\n", "\0")),
                "CONFIGURE_PASSWORD_INVALID")
        password_bytes = password.encode("utf-8", errors="strict")
        require(len(password_bytes) <= MAX_INPUT_BYTES, "CONFIGURE_PASSWORD_INVALID")
        email = input("ACME certificate contact email: ").strip()
        require(len(email) <= 254 and re.fullmatch(r"[A-Za-z0-9._+-]{1,64}@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}", email),
                "CONFIGURE_ACME_EMAIL_INVALID")
        require(identity(jwt_source.lstat()) == identity(jwt_info), "CONFIGURE_JWT_SOURCE_CHANGED")
        require_absent(directory_fd)
        env_bytes = render_environment(template, environment_values(release, email))
        write_exclusive(directory_fd, (("jwt-secret", jwt_bytes), ("mysql-password", password_bytes), ("production.env", env_bytes)))
    finally:
        os.close(directory_fd)
    print("CONFIGURE_HOST=COMPLETE")
    print("ENV_FILE=" + str(SECRETS / "production.env"))
    print("FILES_OWNER=1000:1000 FILES_MODE=0400")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release", required=True, help="Absolute path to the extracted release")
    parser.add_argument("--jwt-source", required=True, help="Absolute path to the preserved raw JWT export")
    args = parser.parse_args()
    try:
        configure(args)
        return 0
    except ConfigurationError as error:
        print(str(error), file=sys.stderr)
    except (KeyboardInterrupt, EOFError):
        print("CONFIGURE_CANCELLED", file=sys.stderr)
        return 130
    except getpass.GetPassWarning:
        print("CONFIGURE_HIDDEN_PASSWORD_INPUT_UNAVAILABLE", file=sys.stderr)
    except (OSError, UnicodeError, ValueError):
        print("CONFIGURE_HOST_IO_FAILED", file=sys.stderr)
    except Exception:
        print("CONFIGURE_HOST_FAILED", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())

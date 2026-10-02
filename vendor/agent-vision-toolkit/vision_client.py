#!/usr/bin/env python3
"""Shared multi-provider vision client used by the proxy and glance CLI."""

from __future__ import annotations

import base64
from email.utils import parsedate_to_datetime
import http.client
import json
import mimetypes
import os
from pathlib import Path
import ssl
import sys
import time
import urllib.error
import urllib.request

DEFAULT_PROMPT = "Please describe the contents of this image in detail."
DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/126.0.0.0 Safari/537.36"
)

LANG_INSTRUCTIONS = {
    "zh": "请使用简体中文回答。",
    "en": "Please respond in English.",
}


class VisionError(RuntimeError):
    """A safe, user-facing vision request failure."""


def load_env_file(path: str | os.PathLike[str] | None) -> None:
    if not path:
        return
    env_path = Path(path).expanduser()
    if not env_path.is_file():
        return
    for raw_line in env_path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        # The env file is the user's explicit configuration: whatever it sets wins,
        # even when the same variable already exists in the system environment.
        if key:
            os.environ[key] = value


def load_default_env() -> None:
    explicit = os.environ.get("VISION_ENV_FILE")
    if explicit:
        load_env_file(Path(explicit).expanduser())
        return
    candidates = []
    local_appdata = os.environ.get("LOCALAPPDATA")
    if local_appdata:
        candidates.append(Path(local_appdata) / "agent-vision-toolkit" / "env")
    candidates.extend([
        Path.home() / ".config" / "agent-vision-toolkit" / "env",
        Path(__file__).resolve().parent / ".env",
        Path.cwd() / ".env",
    ])
    for path in candidates:
        load_env_file(path)


def _required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise VisionError(f"Missing config {name}; fill it in the .env file")
    return value


def validate_vision_config() -> None:
    for name in ("VISION_API_KEY", "VISION_BASE_URL", "VISION_MODEL"):
        _required(name)


def image_path_to_data_url(path: str | os.PathLike[str]) -> str:
    image_path = Path(path).expanduser()
    if not image_path.is_file():
        raise VisionError(f"Image not found: {image_path}")
    mime, _ = mimetypes.guess_type(image_path.name)
    if mime not in {"image/png", "image/jpeg", "image/gif", "image/webp"}:
        raise VisionError("Only PNG, JPEG, GIF, and WebP images are supported")
    return f"data:{mime};base64,{base64.b64encode(image_path.read_bytes()).decode()}"


# Media kinds accepted by the multimodal pipeline. The kind of one input is
# decided by its media type; VISION_MODALITIES (set by the DSH runtime from
# the per-model capability matrix) gates which kinds may actually be sent.
MEDIA_KINDS = {"image", "video", "audio", "document"}

_DOCUMENT_MEDIA_TYPES = {
    "application/pdf": ".pdf",
    "application/msword": ".doc",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.ms-powerpoint": ".ppt",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
}

_EXTENSION_MEDIA_TYPES = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp",
    ".mp4": "video/mp4", ".m4v": "video/mp4", ".webm": "video/webm",
    ".mkv": "video/x-matroska", ".mov": "video/quicktime",
    ".avi": "video/x-msvideo", ".3gp": "video/3gpp",
    ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4",
    ".aac": "audio/aac", ".ogg": "audio/ogg", ".opus": "audio/opus",
    ".flac": "audio/flac",
    ".pdf": "application/pdf", ".doc": "application/msword",
    ".xls": "application/vnd.ms-excel", ".ppt": "application/vnd.ms-powerpoint",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}


def enabled_modalities() -> frozenset[str]:
    """Input modalities the configured model accepts.

    ``VISION_MODALITIES`` is a comma/space separated list (image, video,
    audio, document). An unset variable keeps the historical image-only
    behavior; an explicitly empty value disables every modality so a
    text-only model fails loudly instead of receiving bytes it cannot read.
    """
    raw = os.environ.get("VISION_MODALITIES")
    if raw is None:
        return frozenset({"image"})
    return frozenset(
        token.strip().lower()
        for token in raw.replace(",", " ").split()
        if token.strip().lower() in MEDIA_KINDS
    )


def _modality_error(modality: str) -> VisionError:
    return VisionError(
        f"the configured model does not accept {modality} input "
        "(VISION_MODALITIES); adjust the model capabilities in Vision Toolkit Settings"
    )


def media_path_to_data_url(path: str | os.PathLike[str]) -> str:
    """Load one image, video, audio, or document file as a data URL."""
    media_path = Path(path).expanduser()
    if not media_path.is_file():
        raise VisionError(f"Media file not found: {media_path}")
    extension = media_path.suffix.lower()
    media_type = _EXTENSION_MEDIA_TYPES.get(extension)
    if media_type is None:
        raise VisionError(
            "Unsupported input type; accepted extensions: "
            + ", ".join(sorted(_EXTENSION_MEDIA_TYPES))
        )
    return f"data:{media_type};base64,{base64.b64encode(media_path.read_bytes()).decode()}"


def _media_kind(url: str) -> str:
    """Classify one input URL as image, video, audio, or document."""
    if not url.startswith("data:"):
        # http(s) URLs keep the legacy image interpretation; providers fetch
        # them server-side and glance only produces data URLs for local files.
        return "image"
    header, separator, _ = url.partition(",")
    if separator == "" or ";base64" not in header:
        raise VisionError("Data URLs must use base64 encoding")
    media_type = header[5:].split(";", 1)[0].strip().lower()
    if media_type.startswith("image/"):
        return "image"
    if media_type.startswith("video/"):
        return "video"
    if media_type.startswith("audio/"):
        return "audio"
    if media_type in _DOCUMENT_MEDIA_TYPES:
        return "document"
    raise VisionError(f"Unsupported media type: {media_type}")


def _data_url_parts(url: str) -> tuple[str, str]:
    """Split one data URL into (media type, raw base64 payload)."""
    header, separator, data = url.partition(",")
    if separator == "" or ";base64" not in header:
        raise VisionError("Data URLs must use base64 encoding")
    return header[5:].split(";", 1)[0].strip().lower(), data


def _document_filename(media_type: str) -> str:
    return "document" + _DOCUMENT_MEDIA_TYPES.get(media_type, ".bin")


def _chat_completion_part(url: str, kind: str) -> dict:
    """One content part for OpenAI Chat Completions requests."""
    if kind == "image":
        return {"type": "image_url", "image_url": {"url": url}}
    if kind == "video":
        return {"type": "video_url", "video_url": {"url": url}}
    if kind == "audio":
        media_type, data = _data_url_parts(url)
        # OpenAI-compatible relays (including DashScope-compatible Qwen
        # endpoints) accept input_audio with the raw base64 payload and the
        # container format name.
        audio_format = media_type.split("/")[-1]
        if audio_format in {"mpeg", "mp4", "wav", "ogg", "flac", "aac", "opus", "webm"}:
            pass
        elif audio_format == "x-matroska":
            audio_format = "webm"
        else:
            audio_format = "mp3"
        return {"type": "input_audio", "input_audio": {"data": data, "format": audio_format}}
    media_type, _ = _data_url_parts(url)
    # DashScope-compatible Qwen endpoints accept base64 documents through the
    # file content part.
    return {"type": "file", "file": {"file_data": url, "file_name": _document_filename(media_type)}}


def _responses_part(url: str, kind: str) -> dict:
    """One content part for OpenAI Responses requests."""
    if kind == "image":
        return {"type": "input_image", "image_url": url}
    if kind == "audio" or kind == "video":
        raise VisionError(
            f"the OpenAI Responses protocol does not support {kind} input; "
            "switch the provider protocol to OpenAI Chat Completions or use a relay that translates it"
        )
    media_type, _ = _data_url_parts(url)
    return {
        "type": "input_file",
        "file": {"file_data": url, "filename": _document_filename(media_type)},
    }


def _anthropic_document_source(url: str) -> dict:
    media_type, data = _data_url_parts(url)
    if media_type != "application/pdf":
        raise VisionError("Anthropic document input supports PDF only")
    return {"type": "base64", "media_type": media_type, "data": data}


def _anthropic_part(url: str, kind: str) -> dict:
    """One content part for Anthropic Messages requests."""
    if kind == "image":
        return {"type": "image", "source": _anthropic_image_source(url)}
    if kind == "document":
        return {"type": "document", "source": _anthropic_document_source(url)}
    raise VisionError(
        f"the Anthropic Messages protocol does not support {kind} input; "
        "switch the provider protocol to OpenAI Chat Completions or use a relay that translates it"
    )


def _message_text(message: object) -> str:
    if isinstance(message, str):
        return message.strip()
    if isinstance(message, list):
        return "\n".join(
            part["text"] for part in message
            if isinstance(part, dict) and isinstance(part.get("text"), str)
        ).strip()
    return ""


def _responses_text(response: object) -> str:
    if not isinstance(response, dict) or not isinstance(response.get("output"), list):
        return ""
    return "\n".join(
        part["text"]
        for item in response["output"]
        if isinstance(item, dict) and item.get("type") == "message"
        and isinstance(item.get("content"), list)
        for part in item["content"]
        if isinstance(part, dict) and part.get("type") == "output_text"
        and isinstance(part.get("text"), str)
    ).strip()


def _anthropic_image_source(url: str) -> dict[str, str]:
    if not url.startswith("data:"):
        return {"type": "url", "url": url}
    header, separator, data = url.partition(",")
    if separator == "" or ";base64" not in header:
        raise VisionError("Anthropic image data URLs must use base64 encoding")
    media_type = header[5:].split(";", 1)[0]
    if not media_type:
        raise VisionError("Anthropic image data URLs must include a media type")
    return {"type": "base64", "media_type": media_type, "data": data}


def _anthropic_text(response: object) -> str:
    if not isinstance(response, dict) or not isinstance(response.get("content"), list):
        return ""
    return "\n".join(
        block["text"]
        for block in response["content"]
        if isinstance(block, dict) and block.get("type") == "text"
        and isinstance(block.get("text"), str)
    ).strip()


def _redact(text: str, *secrets: str) -> str:
    for secret in secrets:
        if secret:
            text = text.replace(secret, "<redacted>")
    return text


def _ssl_context() -> ssl.SSLContext | None:
    """Return an unverified context when VISION_SSL_VERIFY disables certificate checks."""
    verify = os.environ.get("VISION_SSL_VERIFY", "").strip().lower()
    if verify in {"0", "false", "off", "no", "none", "disabled"}:
        context = ssl.create_default_context()
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
        return context
    return None


def _retry_delay(error: urllib.error.HTTPError, attempt: int) -> float:
    value = error.headers.get("Retry-After")
    if value:
        try:
            return max(0.0, min(float(value), 60.0))
        except ValueError:
            try:
                retry_at = parsedate_to_datetime(value)
                return max(0.0, min(retry_at.timestamp() - time.time(), 60.0))
            except (TypeError, ValueError, OverflowError):
                pass
    return min(2 ** attempt, 4)


def _api_error_code(body: bytes) -> str:
    try:
        payload = json.loads(body.decode(errors="replace"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return ""
    if not isinstance(payload, dict):
        return ""
    error = payload.get("error")
    if not isinstance(error, dict):
        return ""
    code = error.get("code")
    return code if isinstance(code, str) else ""


def _retryable_http_error(status: int, body: bytes) -> bool:
    if status not in {429, 500, 502, 503, 504, 529}:
        return False
    return _api_error_code(body) not in {
        "daily_rate_limit_exceeded",
        "global_daily_limit_exceeded",
        "rate_limit_exceeded",
    }


def describe_image(image_url: str | list[str], prompt: str | None = None, max_tokens: int = 4096,
                   apply_lang: bool = True) -> str:
    """Describe one data/http image URL (str) or several (list) in a single call.

    Beyond images, data URLs carrying video, audio, or documents are routed to
    protocol-appropriate content parts, gated by the enabled modalities.
    """
    validate_vision_config()
    urls = [image_url] if isinstance(image_url, str) else list(image_url)
    if not urls:
        raise VisionError("No image was provided")
    for url in urls:
        if not url.startswith(("data:", "http://", "https://")):
            raise VisionError("Only data URLs or http(s) image URLs are supported")
    base_url = _required("VISION_BASE_URL").rstrip("/")
    api_key = _required("VISION_API_KEY")
    user_agent = os.environ.get("VISION_USER_AGENT", "").strip() or DEFAULT_USER_AGENT
    text = prompt or DEFAULT_PROMPT
    if apply_lang:
        instruction = LANG_INSTRUCTIONS.get(os.environ.get("LANG", "").strip().lower())
        if instruction:
            text = f"{instruction}\n\n{text}"
    model = _required("VISION_MODEL")
    protocol = os.environ.get("VISION_API_PROTOCOL", "").strip().lower() or "chat_completions"

    modalities = enabled_modalities()
    kinds = []
    for url in urls:
        kind = _media_kind(url)
        if kind not in modalities:
            raise _modality_error(kind)
        kinds.append(kind)

    if protocol == "responses":
        payload = {
            "model": model,
            "store": False,
            "input": [{"role": "user", "content": [
                _responses_part(url, kind) for url, kind in zip(urls, kinds)
            ] + [{"type": "input_text", "text": text}]}],
        }
        if max_tokens is not None:
            payload["max_output_tokens"] = max_tokens
        reasoning_effort = os.environ.get("VISION_REASONING_EFFORT", "").strip()
        if reasoning_effort:
            payload["reasoning"] = {"effort": reasoning_effort}
        endpoint = "/responses"
        extract_text = _responses_text
    elif protocol == "chat_completions":
        payload = {
            "model": model,
            "messages": [{"role": "user", "content": [
                _chat_completion_part(url, kind) for url, kind in zip(urls, kinds)
            ] + [{"type": "text", "text": text}]}],
        }
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens
        endpoint = "/chat/completions"
        extract_text = lambda data: _message_text(data["choices"][0]["message"]["content"])
    elif protocol == "anthropic":
        payload = {
            "model": model,
            "max_tokens": max_tokens if max_tokens is not None else 4096,
            "messages": [{"role": "user", "content": [
                _anthropic_part(url, kind) for url, kind in zip(urls, kinds)
            ] + [{"type": "text", "text": text}]}],
        }
        thinking = os.environ.get("VISION_ANTHROPIC_THINKING", "").strip().lower() or "omit"
        if thinking != "omit":
            if thinking not in {"disabled", "adaptive"}:
                raise VisionError(
                    "Unsupported VISION_ANTHROPIC_THINKING; use omit, disabled, or adaptive"
                )
            payload["thinking"] = {"type": thinking}
        endpoint = "/messages"
        extract_text = _anthropic_text
    else:
        raise VisionError(
            "Unsupported VISION_API_PROTOCOL; use chat_completions, responses, or anthropic"
        )
    headers = {
        "Content-Type": "application/json",
        "User-Agent": user_agent,
    }
    if protocol == "anthropic":
        headers.update({
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
        })
    else:
        headers["Authorization"] = "Bearer " + api_key
    request = urllib.request.Request(base_url + endpoint, data=json.dumps(payload).encode(), headers=headers)
    context = _ssl_context()
    retries = 2
    timeout = 180
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(request, timeout=timeout, context=context) as response:
                data = json.load(response)
            try:
                text = extract_text(data)
            except (KeyError, IndexError, TypeError) as exc:
                raise VisionError("Vision API returned an incompatible response structure") from exc
            if not text:
                raise VisionError("Vision API returned an empty description")
            return text
        except urllib.error.HTTPError as exc:
            raw_body = exc.read()
            body = _redact(raw_body.decode(errors="replace")[:400], api_key)
            body = body.replace("\r", " ").replace("\n", " ")
            if _retryable_http_error(exc.code, raw_body) and attempt < retries:
                print(f"vision: HTTP {exc.code}, retrying ({attempt + 1}/{retries})", file=sys.stderr)
                time.sleep(_retry_delay(exc, attempt))
                continue
            raise VisionError(f"Vision API HTTP {exc.code}: {body}") from exc
        except (urllib.error.URLError, TimeoutError, ConnectionError, http.client.IncompleteRead) as exc:
            if attempt < retries:
                print(f"vision: {type(exc).__name__}, retrying ({attempt + 1}/{retries})", file=sys.stderr)
                time.sleep(min(2 ** attempt, 4))
                continue
            reason = _redact(str(getattr(exc, "reason", str(exc))), api_key)
            raise VisionError(f"Vision API network error: {reason}") from exc
        except json.JSONDecodeError as exc:
            raise VisionError("Vision API returned invalid JSON") from exc
    raise VisionError("Vision API request failed")

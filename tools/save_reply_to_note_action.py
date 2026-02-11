"""
title: Save Reply To Note
author: Richard Lew
author_url: https://openwebui.com
funding_url: https://github.com/open-webui/open-webui
version: 0.1.0
license: MIT
required_open_webui_version: 0.6.43
"""

import hashlib
import re
from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field


class Action:
    REASONING_BLOCK_TYPES = {"reasoning", "thinking", "thought", "reason"}
    REASONING_TAG_PAIRS = [
        ("<think>", "</think>"),
        ("<thinking>", "</thinking>"),
        ("<reason>", "</reason>"),
        ("<reasoning>", "</reasoning>"),
        ("<thought>", "</thought>"),
        ("<Thought>", "</Thought>"),
        ("<|begin_of_thought|>", "<|end_of_thought|>"),
        ("◁think▷", "◁/think▷"),
    ]

    class Valves(BaseModel):
        title_prefix: str = Field(
            default="聊天笔记",
            description="新笔记标题前缀。",
        )
        ask_title: bool = Field(
            default=False,
            description="点击按钮时是否弹窗让用户输入标题。",
        )
        prevent_duplicates: bool = Field(
            default=True,
            description="是否避免重复保存相同回答内容。",
        )
        duplicate_scan_limit: int = Field(
            default=100,
            description="用于重复检测的最近笔记扫描数量。",
        )
        max_title_length: int = Field(
            default=80,
            description="自动生成标题的最大长度。",
        )

    class UserValves(BaseModel):
        title_prefix: str = Field(
            default="",
            description="用户级标题前缀（为空则使用系统默认）。",
        )
        ask_title: bool = Field(
            default=False,
            description="用户级：是否弹窗输入标题。",
        )

    def __init__(self):
        self.valves = self.Valves()

    def _normalize_user_valves(self, __user__: dict) -> "Action.UserValves":
        user_valves = (__user__ or {}).get("valves")
        if isinstance(user_valves, self.UserValves):
            return user_valves
        if isinstance(user_valves, dict):
            return self.UserValves(**user_valves)
        return self.UserValves()

    def _content_to_markdown(self, content: Any) -> str:
        if content is None:
            return ""

        if isinstance(content, str):
            return content.strip()

        if isinstance(content, list):
            parts = []
            for item in content:
                if isinstance(item, str):
                    if item.strip():
                        parts.append(item.strip())
                    continue

                if isinstance(item, dict):
                    item_type = item.get("type")
                    if item_type in self.REASONING_BLOCK_TYPES:
                        continue
                    if item_type == "text" and isinstance(item.get("text"), str):
                        text = item.get("text", "").strip()
                        if text:
                            parts.append(text)
                    elif isinstance(item.get("content"), str):
                        text = item.get("content", "").strip()
                        if text:
                            parts.append(text)
                    elif isinstance(item.get("md"), str):
                        text = item.get("md", "").strip()
                        if text:
                            parts.append(text)
            return "\n\n".join(parts).strip()

        if isinstance(content, dict):
            for key in ("md", "text", "content"):
                value = content.get(key)
                if isinstance(value, str) and value.strip():
                    return value.strip()
                if isinstance(value, (list, dict)):
                    parsed = self._content_to_markdown(value)
                    if parsed:
                        return parsed

        return ""

    def _strip_thinking_content(self, text: str) -> str:
        if not text:
            return ""

        cleaned = text

        # 清理 UI 渲染后的 reasoning details 块
        cleaned = re.sub(
            r"<details[^>]*type=[\"']reasoning[\"'][^>]*>[\s\S]*?</details>",
            "",
            cleaned,
            flags=re.IGNORECASE,
        )

        # 清理模型输出中的思考标签
        for start_tag, end_tag in self.REASONING_TAG_PAIRS:
            if start_tag.startswith("<") and start_tag.endswith(">") and not start_tag.startswith("<|"):
                start_tag_pattern = rf"<{re.escape(start_tag[1:-1])}(\s.*?)?>"
            else:
                start_tag_pattern = re.escape(start_tag)

            cleaned = re.sub(
                rf"{start_tag_pattern}[\s\S]*?{re.escape(end_tag)}",
                "",
                cleaned,
                flags=re.IGNORECASE,
            )
            # 若标签未闭合，兜底去掉到结尾
            cleaned = re.sub(
                rf"{start_tag_pattern}[\s\S]*$",
                "",
                cleaned,
                flags=re.IGNORECASE,
            )

        cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
        return cleaned.strip()

    def _extract_chat_title(self, body: dict, user_id: str) -> str:
        # 先从 body 里直接拿，避免不必要查询
        direct_candidates = [
            body.get("chat_title"),
            body.get("title"),
            (body.get("chat") or {}).get("title") if isinstance(body.get("chat"), dict) else None,
        ]
        for candidate in direct_candidates:
            if isinstance(candidate, str) and candidate.strip():
                return candidate.strip()

        chat_id = body.get("chat_id")
        if not isinstance(chat_id, str) or not chat_id.strip():
            return ""

        try:
            from open_webui.models.chats import Chats

            chat = Chats.get_chat_by_id_and_user_id(chat_id, user_id)
            if chat and isinstance(chat.title, str) and chat.title.strip():
                return chat.title.strip()
        except Exception:
            pass

        return ""

    def _extract_target_content(self, body: dict) -> str:
        # 优先读取“当前被点击消息”
        direct_msg = body.get("message")
        if isinstance(direct_msg, dict):
            direct_content = self._content_to_markdown(direct_msg.get("content"))
            if direct_content:
                return direct_content

        messages = body.get("messages", [])
        if isinstance(messages, list) and messages:
            # 优先最后一条 assistant 消息
            for msg in reversed(messages):
                if not isinstance(msg, dict):
                    continue
                if msg.get("role") == "assistant":
                    content = self._content_to_markdown(msg.get("content"))
                    if content:
                        return content

            # 兜底：最后一条有内容的消息
            for msg in reversed(messages):
                if not isinstance(msg, dict):
                    continue
                content = self._content_to_markdown(msg.get("content"))
                if content:
                    return content

        return ""

    def _build_title(self, content: str, prefix: str, max_len: int) -> str:
        first_line = ""
        for line in content.splitlines():
            clean = re.sub(r"^#+\s*", "", line).strip()
            if clean:
                first_line = clean
                break

        if not first_line:
            first_line = "新笔记"

        first_line = re.sub(r"\s+", " ", first_line).strip()
        if len(first_line) > max_len:
            first_line = f"{first_line[: max_len - 1]}…"

        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M")
        return f"{prefix} | {first_line} | {timestamp}"

    async def _emit(self, __event_emitter__, event_type: str, data: dict):
        if __event_emitter__:
            await __event_emitter__({"type": event_type, "data": data})

    async def action(
        self,
        body: dict,
        __user__: dict = None,
        __event_emitter__=None,
        __event_call__=None,
        __request__=None,
    ) -> Optional[dict]:
        if not __user__ or not __user__.get("id"):
            await self._emit(
                __event_emitter__,
                "notification",
                {"type": "error", "content": "无法读取用户信息，保存失败。"},
            )
            return None

        user_valves = self._normalize_user_valves(__user__)
        title_prefix = user_valves.title_prefix or self.valves.title_prefix
        ask_title = user_valves.ask_title or self.valves.ask_title

        content = self._extract_target_content(body)
        content = self._strip_thinking_content(content)
        if not content:
            await self._emit(
                __event_emitter__,
                "notification",
                {"type": "warning", "content": "没有找到可保存的回答正文（可能只有思考内容）。"},
            )
            return None

        await self._emit(
            __event_emitter__,
            "status",
            {"description": "正在保存回答到 Notes..."},
        )

        try:
            from open_webui.models.notes import NoteForm, Notes
        except Exception as e:
            await self._emit(
                __event_emitter__,
                "status",
                {"description": "", "done": True},
            )
            await self._emit(
                __event_emitter__,
                "notification",
                {"type": "error", "content": f"Notes 模块不可用: {e}"},
            )
            return None

        user_id = __user__["id"]
        content_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()

        if self.valves.prevent_duplicates:
            try:
                recent_notes = Notes.get_notes_by_user_id(
                    user_id=user_id,
                    permission="write",
                    limit=self.valves.duplicate_scan_limit,
                )
                for note in recent_notes:
                    meta = note.meta or {}
                    if (
                        meta.get("source") == "save_reply_to_note_action"
                        and meta.get("content_sha256") == content_hash
                    ):
                        await self._emit(
                            __event_emitter__,
                            "status",
                            {"description": "", "done": True},
                        )
                        await self._emit(
                            __event_emitter__,
                            "notification",
                            {
                                "type": "info",
                                "content": f"这条回答已保存过（Note ID: {note.id}）。",
                            },
                        )
                        return {"status": "duplicate", "id": note.id, "title": note.title}
            except Exception:
                # 重复检测失败不阻断主流程
                pass

        chat_title = self._extract_chat_title(body, user_id)
        title = (
            chat_title
            if chat_title
            else self._build_title(content, title_prefix, self.valves.max_title_length)
        )
        if ask_title and __event_call__:
            try:
                input_title = await __event_call__(
                    {
                        "type": "input",
                        "data": {
                            "title": "保存为笔记",
                            "message": "输入笔记标题（留空则使用自动标题）",
                            "placeholder": title,
                        },
                    }
                )
                if isinstance(input_title, str) and input_title.strip():
                    title = input_title.strip()
            except Exception:
                pass

        note_form = NoteForm(
            title=title,
            data={"content": {"md": content}},
            meta={
                "source": "save_reply_to_note_action",
                "chat_id": body.get("chat_id"),
                "message_id": body.get("id"),
                "content_sha256": content_hash,
            },
            access_control={},  # 私有：仅拥有者可访问
        )

        new_note = Notes.insert_new_note(user_id=user_id, form_data=note_form)

        await self._emit(
            __event_emitter__,
            "status",
            {"description": "", "done": True},
        )

        if not new_note:
            await self._emit(
                __event_emitter__,
                "notification",
                {"type": "error", "content": "保存失败：未成功创建笔记。"},
            )
            return None

        await self._emit(
            __event_emitter__,
            "notification",
            {
                "type": "success",
                "content": f"已保存为笔记：{new_note.title}",
            },
        )

        return {"status": "success", "id": new_note.id, "title": new_note.title}

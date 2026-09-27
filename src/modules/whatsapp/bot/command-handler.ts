import { prisma } from "@/lib/prisma";
import type { WASocket, WAMessage } from "@whiskeysockets/baileys";
import { downloadMediaMessage, areJidsSameUser } from "@whiskeysockets/baileys";
import Sticker from "wa-sticker-formatter";
import sharp from "sharp";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { exec } from "child_process";
import { promisify } from "util";
import { logger } from "@/lib/logger";
import { makeChatKey, getChatState, setChatState, clearChatState } from "./chat-state";

const execAsync = promisify(exec);

// Map to track start times for uptime
const startTimes = new Map<string, number>();

// Default bot config
// Default bot config
const DEFAULT_CONFIG = {
    enabled: true,
    botMode: 'OWNER',
    botAllowedJids: [] as string[],
    autoReplyMode: 'ALL',
    autoReplyAllowedJids: [] as string[],
    enableSticker: true,
    enableVideoSticker: true,
    maxStickerDuration: 10,
    enablePing: true,
    enableUptime: true,
    botName: "WA-AKG Bot",
    prefix: "#",
    removeBgApiKey: null as string | null
};

/** Build response text with sub-menu items appended */
function buildResponseWithSubMenu(response: string, subCommands: any[], prefix: string): string {
    let text = response || "";
    if (Array.isArray(subCommands) && subCommands.length > 0) {
        text += `\n\n📋 *Reply with:*\n`;
        for (const sc of subCommands) {
            if (sc.command) {
                text += `• *${prefix ? prefix : ""}${sc.command}*${sc.description ? ` — ${sc.description}` : ""}\n`;
            }
        }
        text += `\n_Type *0* or *back* to go back_`;
    }
    return text;
}

/** Walk the menuPath to find the subCommands array at the current nesting level */
function resolveCommandsAtPath(customCommands: any[], menuPath: string[]): any[] {
    let commands = customCommands;
    for (const segment of menuPath) {
        const parent = commands.find((cc: any) => cc.command && cc.command.toLowerCase() === segment);
        if (!parent || !Array.isArray(parent.subCommands)) return [];
        commands = parent.subCommands;
    }
    return commands;
}

export function setSessionStartTime(sessionId: string) {
    if (!startTimes.has(sessionId)) {
        startTimes.set(sessionId, Date.now());
    }
}

// ===== Helpers for group commands =====
function isGroupJid(jid: string) {
    return jid.endsWith("@g.us");
}

/**
 * Wrap the socket so all sendMessage calls from interactive commands use
 * skipQueue:true and send instantly without the anti-ban typing delay, which makes
 * command responses feel slow. Other methods (groupMetadata, etc.) pass through unchanged.
 */
function makeFastSock(sock: WASocket): WASocket {
    return new Proxy(sock, {
        get(target, prop) {
            if (prop === "sendMessage") {
                return (jid: string, content: any, options?: any) =>
                    (target.sendMessage as any)(jid, content, { ...(options || {}), skipQueue: true });
            }
            const val = (target as any)[prop];
            return typeof val === "function" ? val.bind(target) : val;
        },
    }) as WASocket;
}

// Briefly cache group metadata so group commands do not fetch it every time
// (reduces latency and rate limits). Short TTL because admins/members can change.
const groupMetaCache = new Map<string, { meta: any; at: number }>();
const GROUP_META_TTL = 15_000;

async function getGroupMetadataCached(sock: WASocket, jid: string): Promise<any> {
    const cached = groupMetaCache.get(jid);
    if (cached && Date.now() - cached.at < GROUP_META_TTL) return cached.meta;
    const meta = await sock.groupMetadata(jid);
    groupMetaCache.set(jid, { meta, at: Date.now() });
    return meta;
}

function safeSameUser(a?: string, b?: string): boolean {
    if (!a || !b) return false;
    try {
        return areJidsSameUser(a, b);
    } catch {
        return false;
    }
}

/**
 * Cek apakah salah satu identitas kandidat (nomor/LID) cocok dengan peserta
 * that have admin status. Newer WhatsApp versions use LID (@lid) for participant IDs,
 * so bot/sender identity must be matched against id, jid, lid, and phoneNumber.
 */
function matchesAdmin(participants: any[], candidates: (string | null | undefined)[]): boolean {
    const cands = candidates.filter(Boolean) as string[];
    if (!cands.length) return false;
    return participants.some((p: any) => {
        const isAdm = p.admin === "admin" || p.admin === "superadmin";
        if (!isAdm) return false;
        const fields = [p.id, p.jid, p.lid, p.phoneNumber].filter(Boolean);
        return cands.some((c) => fields.some((f) => safeSameUser(f, c)));
    });
}

/**
 * Requirements: in groups, the sender must be an admin (or owner/fromMe), and the bot must be an admin.
 * Returns metadata when valid, or an error message.
 */
async function requireGroupAdmin(
    sock: WASocket,
    remoteJid: string,
    msg: WAMessage,
    fromMe: boolean
): Promise<{ ok: boolean; metadata?: any; error?: string }> {
    if (!isGroupJid(remoteJid)) return { ok: false, error: "❌ This command can only be used in a group." };

    let metadata: any;
    try {
        metadata = await getGroupMetadataCached(sock, remoteJid);
    } catch {
        return { ok: false, error: "❌ Failed to get group data." };
    }

    const participants = metadata.participants || [];

    // The bot can be identified by number (id) OR LID; check both.
    const botCandidates = [sock.user?.id, (sock.user as any)?.lid];
    const botIsAdmin = matchesAdmin(participants, botCandidates);

    // The sender can also be a number or LID depending on the version/group.
    const k: any = msg.key;
    const ctx: any = msg.message?.extendedTextMessage?.contextInfo;
    const senderCandidates = [
        k.participant,
        k.participantAlt,
        k.participantPn,
        (msg as any).participant,
        ctx?.participant,
    ];
    const senderIsAdmin = fromMe || matchesAdmin(participants, senderCandidates);

    if (!senderIsAdmin) return { ok: false, error: "❌ Group admins only." };
    if (!botIsAdmin) return { ok: false, error: "❌ Make the bot a group admin first." };

    return { ok: true, metadata };
}

/** Ambil target JID dari: mention > reply > nomor di argumen. */
function resolveTargetJids(msg: WAMessage, args: string[]): string[] {
    const ctx = msg.message?.extendedTextMessage?.contextInfo;
    const mentioned = ctx?.mentionedJid || [];
    if (mentioned.length) return mentioned;
    if (ctx?.participant) return [ctx.participant];
    const nums = args.map((a) => a.replace(/[^0-9]/g, "")).filter((n) => n.length >= 6);
    return nums.map((n) => `${n}@s.whatsapp.net`);
}

export async function handleBotCommand(
    sock: WASocket | undefined,
    sessionId: string,
    msg: WAMessage
) {
    if (!sock || !msg.message || !msg.key.remoteJid) return;

    // All command replies use fast-send (without the anti-ban delay) for responsiveness.
    sock = makeFastSock(sock);

    const remoteJid = msg.key.remoteJid;
    const fromMe = msg.key.fromMe || false;

    // Get text content
    let text = "";
    const messageContent = msg.message;

    if (messageContent.conversation) {
        text = messageContent.conversation;
    } else if (messageContent.extendedTextMessage?.text) {
        text = messageContent.extendedTextMessage.text;
    } else if (messageContent.imageMessage?.caption) {
        text = messageContent.imageMessage.caption;
    } else if (messageContent.videoMessage?.caption) {
        text = messageContent.videoMessage.caption;
    }

    // Quick check: skip non-command messages early (common prefixes)
    // We'll do a proper prefix check after loading config
    if (!text || text.length === 0) return;

    // Fetch session first
    const session = await prisma.session.findUnique({
        where: { sessionId },
        select: { id: true }
    });

    if (!session) return;

    // Fetch BotConfig separately
    // @ts-ignore - Prisma Client types might lag in IDE
    const botConfig = await (prisma as any).botConfig.findUnique({
        where: { sessionId: session.id }
    });

    const config = botConfig || DEFAULT_CONFIG;

    if (!config.enabled) return;

    const prefix = (config as any).prefix ?? "#";
    const isPrefixed = prefix.length > 0 ? text.startsWith(prefix) : false;
    const chatKey = makeChatKey(sessionId, remoteJid);
    const chatState = getChatState(chatKey);

    // Livechat mode: block ALL bot responses except the endchat command
    if (chatState?.state === "livechat") {
        if (isPrefixed) {
            const [lcCommand] = text.trim().split(" ");
            const lcCmd = lcCommand.toLowerCase().slice(prefix.length);
            if (lcCmd === "endchat") {
                clearChatState(chatKey);
                await sock.sendMessage(remoteJid, { text: "✅ Live chat ended. Bot is active again." }, { quoted: msg });
            }
            // Also check universal commands for END_CHAT action
            const universalCmds = Array.isArray((config as any).universalCommands) ? (config as any).universalCommands : [];
            const uniMatch = universalCmds.find((uc: any) => uc.command && uc.command.toLowerCase() === text.trim().toLowerCase() && (uc.action || "").toUpperCase() === "END_CHAT");
            if (uniMatch) {
                clearChatState(chatKey);
                await sock.sendMessage(remoteJid, { text: "✅ Live chat ended. Bot is active again." }, { quoted: msg });
            }
        } else {
            // Check bare universal END_CHAT commands
            const universalCmds = Array.isArray((config as any).universalCommands) ? (config as any).universalCommands : [];
            const uniMatch = universalCmds.find((uc: any) => uc.command && uc.command.toLowerCase() === text.trim().toLowerCase() && (uc.action || "").toUpperCase() === "END_CHAT");
            if (uniMatch) {
                clearChatState(chatKey);
                await sock.sendMessage(remoteJid, { text: "✅ Live chat ended. Bot is active again." }, { quoted: msg });
            }
        }
        return;
    }

    // Handle bare menu/submenu replies (user replies without prefix while in menu context)
    // This works whether prefix is set or not — when in menu/submenu state, bare replies are checked
    const isInMenu = chatState?.state === "menu" || chatState?.state === "submenu";
    const isBareReply = !isPrefixed; // message doesn't start with prefix (or prefix is empty)
    // For empty prefix, isPrefixed is always false, so all messages are "bare" — perfect for prefix-less bots
    if (isBareReply && isInMenu) {
        const customCommands = Array.isArray((config as any).customCommands) ? (config as any).customCommands : [];
        const universalCmds = Array.isArray((config as any).universalCommands) ? (config as any).universalCommands : [
            { command: "0", action: "MAIN_MENU" },
            { command: "back", action: "BACK" },
        ];
        const trimmed = text.trim().toLowerCase();
        const currentPath = chatState!.menuPath || [];

        // Check universal commands first (BACK, MAIN_MENU, END_CHAT, LIVE_CHAT)
        const uniMatch = universalCmds.find((uc: any) => uc.command && uc.command.toLowerCase() === trimmed);
        if (uniMatch) {
            const action = (uniMatch.action || "").toUpperCase();
            if (action === "MAIN_MENU" || (action === "BACK" && currentPath.length <= 1)) {
                setChatState(chatKey, "menu", Date.now() + 30 * 60_000);
                text = `${prefix}menu`;
                // Fall through to prefixed handling below
            } else if (action === "BACK" && currentPath.length > 1) {
                const parentPath = currentPath.slice(0, -1);
                const parentCommands = resolveCommandsAtPath(customCommands, parentPath.slice(0, -1));
                const parentCmd = parentCommands.find((cc: any) => cc.command && cc.command.toLowerCase() === parentPath[parentPath.length - 1]);
                setChatState(chatKey, "submenu", Date.now() + 30 * 60_000, parentPath);
                if (parentCmd) {
                    const replyText = buildResponseWithSubMenu(parentCmd.response, parentCmd.subCommands || [], prefix);
                    if (replyText) await sock.sendMessage(remoteJid, { text: replyText }, { quoted: msg });
                }
                return;
            } else if (action === "END_CHAT") {
                clearChatState(chatKey);
                await sock.sendMessage(remoteJid, { text: "✅ Live chat ended. Bot is active again." }, { quoted: msg });
                return;
            } else if (action === "LIVE_CHAT") {
                const timeout = (config as any).liveChatTimeout || 30;
                setChatState(chatKey, "livechat", Date.now() + timeout * 60_000);
                const lcResponse = uniMatch.description || "🎧 Live chat activated. A human agent will respond shortly.";
                await sock.sendMessage(remoteJid, { text: lcResponse }, { quoted: msg });
                return;
            }
            // For MAIN_MENU, fall through
        } else {
            // Resolve commands at current nesting level
            const currentLevelCmds = chatState!.state === "submenu" && currentPath.length > 0
                ? resolveCommandsAtPath(customCommands, currentPath)
                : customCommands;
            let matched = currentLevelCmds.find((cc: any) => cc.command && cc.command.toLowerCase() === trimmed);

            // Fallback: check isUniversal commands (work at any level)
            if (!matched) {
                matched = customCommands.find((cc: any) => cc.command && cc.command.toLowerCase() === trimmed && cc.isUniversal);
            }

            if (matched) {
                if (matched.isLiveChat) {
                    const timeout = (config as any).liveChatTimeout || 30;
                    setChatState(chatKey, "livechat", Date.now() + timeout * 60_000);
                } else if (Array.isArray(matched.subCommands) && matched.subCommands.length > 0) {
                    const newPath = chatState!.state === "submenu"
                        ? [...currentPath, matched.command.toLowerCase()]
                        : [matched.command.toLowerCase()];
                    setChatState(chatKey, "submenu", Date.now() + 30 * 60_000, newPath);
                } else {
                    setChatState(chatKey, chatState!.state, Date.now() + 30 * 60_000, currentPath.length > 0 ? currentPath : undefined);
                }
                const replyText = Array.isArray(matched.subCommands) && matched.subCommands.length > 0
                    ? buildResponseWithSubMenu(matched.response, matched.subCommands, prefix)
                    : matched.response;
                if (replyText) {
                    await sock.sendMessage(remoteJid, { text: replyText }, { quoted: msg });
                }
            }
            return;
        }
    }

    // For prefix-less bots: when NOT in menu state, still check if text matches a top-level custom command
    if (prefix === "") {
        const customCommands = Array.isArray((config as any).customCommands) ? (config as any).customCommands : [];
        const trimmed = text.trim().toLowerCase();
        const matched = customCommands.find((cc: any) => cc.command && cc.command.toLowerCase() === trimmed);
        if (matched) {
            if (matched.isLiveChat) {
                const timeout = (config as any).liveChatTimeout || 30;
                setChatState(chatKey, "livechat", Date.now() + timeout * 60_000);
            } else if (Array.isArray(matched.subCommands) && matched.subCommands.length > 0) {
                setChatState(chatKey, "submenu", Date.now() + 30 * 60_000, [matched.command.toLowerCase()]);
            }
            const replyText = Array.isArray(matched.subCommands) && matched.subCommands.length > 0
                ? buildResponseWithSubMenu(matched.response, matched.subCommands, prefix)
                : matched.response;
            if (replyText) {
                await sock.sendMessage(remoteJid, { text: replyText }, { quoted: msg });
            }
            return;
        }
        // For prefix-less bots, built-in commands are checked via the switch below
        // but we need isPrefixed to be true for the switch to fire
    }

    if (!isPrefixed && prefix !== "") return;

    // Verify Access Permissions
    const botMode = (config as any).botMode || 'OWNER'; // Default to OWNER if missing

    // Check Permission
    let canExecute = false;

    if (fromMe) {
        canExecute = true; // Owner always allowed
    } else {
        if (botMode === 'ALL') {
            canExecute = true;
        } else if (botMode === 'SPECIFIC') {
            const allowedJids = (config as any).botAllowedJids || [];
            // Standardized Sender Logic (matches webhook & store)
            const isGroup = msg.key.remoteJid?.endsWith("@g.us") || false;
            const remoteJidAlt = msg.key.remoteJidAlt;
            let senderJid = (isGroup ? (msg.key.participant || msg.participant) : msg.key.remoteJid) || "";

            if (!isGroup && remoteJidAlt) {
                senderJid = remoteJidAlt;
            }

            if (Array.isArray(allowedJids)) {
                canExecute = allowedJids.some(jid => senderJid.includes(jid));
            }
        } else if (botMode === 'BLACKLIST') {
            const blockedJids = (config as any).botBlockedJids || [];
            const isGroup = msg.key.remoteJid?.endsWith("@g.us") || false;
            const remoteJidAlt = msg.key.remoteJidAlt;
            let senderJid = (isGroup ? (msg.key.participant || msg.participant) : msg.key.remoteJid) || "";

            if (!isGroup && remoteJidAlt) {
                senderJid = remoteJidAlt;
            }

            // If blacklist, allowed by default UNLESS in blocked list
            canExecute = true;
            if (Array.isArray(blockedJids)) {
                const isBlocked = blockedJids.some(jid => senderJid.includes(jid));
                if (isBlocked) canExecute = false;
            }
        }
    }

    if (!canExecute) return;

    const [command, ...args] = text.trim().split(" ");
    const cmd = prefix.length > 0 ? command.toLowerCase().slice(prefix.length) : command.toLowerCase(); // remove prefix

    try {
        switch (cmd) {
            case "ping": {
                if (!config.enablePing) return;
                await sock.sendMessage(remoteJid, { text: "Pong! 🏓" }, { quoted: msg });
                break;
            }

            case "id": {
                await sock.sendMessage(remoteJid, {
                    text: `*Chat ID:* \`${remoteJid}\``
                }, { quoted: msg });
                break;
            }

            case "uptime": {
                if (!config.enableUptime) return;

                const start = startTimes.get(sessionId) || Date.now();
                const uptimeMs = Date.now() - start;
                const hours = Math.floor(uptimeMs / 3600000);
                const minutes = Math.floor((uptimeMs % 3600000) / 60000);
                const seconds = Math.floor((uptimeMs % 60000) / 1000);

                await sock.sendMessage(remoteJid, {
                    text: `*Session Uptime:* ${hours}h ${minutes}m ${seconds}s`
                }, { quoted: msg });
                break;
            }

            case "sticker":
            case "s":
            case "stiker": {
                if (!config.enableSticker) return;

                // Check if message has image or video
                let mediaMsg: WAMessage | null = msg;

                // If quoted, check quoted
                const quoted = messageContent.extendedTextMessage?.contextInfo?.quotedMessage;
                if (quoted) {
                    mediaMsg = {
                        key: {
                            remoteJid,
                            id: messageContent.extendedTextMessage?.contextInfo?.stanzaId,
                        },
                        message: quoted
                    } as WAMessage;
                }

                const msgContent = mediaMsg.message;
                const isImage = !!msgContent?.imageMessage;
                const isVideo = !!msgContent?.videoMessage;

                if (!isImage && !isVideo) {
                    await sock.sendMessage(remoteJid, { text: "❌ Please reply to an image/video or send media with caption #sticker" }, { quoted: msg });
                    return;
                }

                if (msgContent?.extendedTextMessage) {
                    await sock.sendMessage(remoteJid, { text: "❌ Cannot convert text message to sticker." }, { quoted: msg });
                    return;
                }

                // Handle Video Limits
                if (isVideo) {
                    if (!(config as any).enableVideoSticker) {
                        await sock.sendMessage(remoteJid, { text: "❌ Video stickers are disabled in bot settings." }, { quoted: msg });
                        return;
                    }

                    const seconds = msgContent?.videoMessage?.seconds || 0;
                    const maxDuration = (config as any).maxStickerDuration || 10;

                    if (seconds > maxDuration) {
                        await sock.sendMessage(remoteJid, { text: `❌ Video too long! Max duration is ${maxDuration} seconds.` }, { quoted: msg });
                        return;
                    }
                }

                await sock.sendMessage(remoteJid, { react: { text: "⏳", key: msg.key } });

                try {
                    // Download
                    let buffer = await downloadMediaMessage(
                        mediaMsg,
                        "buffer",
                        {},
                        {
                            logger: console as any,
                            reuploadRequest: sock.updateMediaMessage
                        }
                    ) as Buffer;

                    // Resize/Compress Logic
                    if (isImage) {
                        try {
                            // Use limitInputPixels: false to handle large images
                            buffer = await sharp(buffer, { limitInputPixels: false })
                                .resize(512, 512, { // Resize to standard 512x512 sticker size directly
                                    fit: 'inside',
                                    withoutEnlargement: true
                                })
                                .toBuffer();
                        } catch (resizeErr) {
                            logger.error("Bot", "Image Resize failed", resizeErr);
                        }
                    } else if (isVideo) {
                        try {
                            const tempInput = path.join(os.tmpdir(), `input_${Date.now()}.mp4`);
                            const tempOutput = path.join(os.tmpdir(), `output_${Date.now()}.mp4`);

                            await fs.writeFile(tempInput, buffer);

                            // Compress Video using ffmpeg
                            // Extreme Compression: 8fps, CRF 40, 300k bitrate, ultrafast
                            await execAsync(`ffmpeg -y -i "${tempInput}" -vf "scale=512:512:force_original_aspect_ratio=decrease,fps=10" -c:v libx264 -preset ultrafast -crf 40 -b:v 300k -maxrate 300k -bufsize 600k -an "${tempOutput}"`);

                            buffer = await fs.readFile(tempOutput);

                            // Cleanup
                            await fs.unlink(tempInput).catch(() => { });
                            await fs.unlink(tempOutput).catch(() => { });
                        } catch (videoErr) {
                            logger.error("Bot", "Video Compression failed", videoErr);
                            // Continue with original buffer if compression fails, or throw? 
                            // If it fails, likely original will fail too, but let's try.
                        }
                    }

                    // Check for background removal (Only for Images)
                    const isRemoveBg = args.includes("nobg") || args.includes("removebg");
                    if (isImage && isRemoveBg && config.removeBgApiKey) {
                        try {
                            // Convert Buffer to Uint8Array for Blob compatibility
                            const uint8Array = new Uint8Array(buffer);
                            const blob = new Blob([uint8Array], { type: 'image/png' });

                            const formData = new FormData();
                            formData.append('image_file', blob, 'image.png');
                            formData.append('size', 'auto');

                            const res = await fetch('https://api.remove.bg/v1.0/removebg', {
                                method: 'POST',
                                headers: {
                                    'X-Api-Key': config.removeBgApiKey
                                },
                                body: formData
                            });

                            if (res.ok) {
                                const arrayBuffer = await res.arrayBuffer();
                                buffer = Buffer.from(arrayBuffer);
                            } else {
                                const err = await res.json();
                                throw new Error(`RemoveBG Error: ${(err as any).errors?.[0]?.title || res.statusText}`);
                            }
                        } catch (bgError) {
                            logger.error("Bot", "RemoveBG Failed:", bgError);
                            await sock.sendMessage(remoteJid, { text: `⚠️ Remove BG failed: ${(bgError as any).message}. Sending normal sticker...` }, { quoted: msg });
                        }
                    } else if (isImage && isRemoveBg && !config.removeBgApiKey) {
                        await sock.sendMessage(remoteJid, { text: `⚠️ Remove BG API Key not configured in dashboard. Sending normal sticker...` }, { quoted: msg });
                    }


                    // Convert
                    const sticker = new Sticker(buffer as Buffer, {
                        pack: (config as any).botName || "WA-AKG Bot",
                        author: "By " + ((config as any).botName || "WA-AKG Bot"),
                        type: "full", // full, crop, circle
                        quality: 15 // Extreme quality reduction for size
                    });

                    const stickerBuffer = await sticker.toBuffer();

                    // Send
                    await sock.sendMessage(remoteJid, { sticker: stickerBuffer }, { quoted: msg });
                    await sock.sendMessage(remoteJid, { react: { text: "✅", key: msg.key } });

                } catch (e) {
                    logger.error("Bot", "Sticker generation failed", e);
                    await sock.sendMessage(remoteJid, { text: "❌ Failed to create sticker. Error: " + (e as any).message }, { quoted: msg });
                }
                break;
            }

            case "menu":
            case "help": {
                const customCmds = Array.isArray((config as any).customCommands) ? (config as any).customCommands : [];
                // If user set custom menu text, use it as base and append custom commands
                if ((config as any).customMenuText) {
                    let menu = (config as any).customMenuText;
                    if ((config as any).autoAppendCommands !== false && customCmds.length > 0) {
                        menu += `\n`;
                        for (const cc of customCmds) {
                            if (cc.command) {
                                menu += `• *${prefix}${cc.command}*${cc.description ? `: ${cc.description}` : ""}\n`;
                            }
                        }
                    }
                    await sock.sendMessage(remoteJid, { text: menu }, { quoted: msg });
                    // Set menu state so user can reply with bare numbers
                    if (customCmds.length > 0) setChatState(chatKey, "menu", Date.now() + 30 * 60_000);
                    break;
                }
                const botName = (config as any).botName || "WA-AKG Bot";
                let menu = `
🤖 *${botName} Menu* 🤖

📌 *Commands:*
• *${prefix}sticker* / *${prefix}s*: Convert Image/Video to Sticker
  - Supports Images, GIFs, and Videos (max ${(config as any).maxStickerDuration || 10}s)
  - Use *${prefix}sticker nobg* to remove background (Images only)
• *${prefix}ping*: Check Bot Status
• *${prefix}uptime*: Check Session Uptime
• *${prefix}id*: Get Chat ID

👥 *Group (admin):*
• *${prefix}tagall* [message]: Tag all members
• *${prefix}hidetag* [message]: Hidden tag
• *${prefix}kick* (tag/reply/number): Remove member
• *${prefix}add* <number>: Add member
• *${prefix}promote* / *${prefix}demote* (tag/reply): Make/remove admin
• *${prefix}open* / *${prefix}close*: Open/close group
`;
                // Append custom commands to menu
                if (customCmds.length > 0) {
                    menu += `\n📋 *Custom Commands:*\n`;
                    for (const cc of customCmds) {
                        if (cc.command) {
                            menu += `• *${prefix}${cc.command}*${cc.description ? `: ${cc.description}` : ""}\n`;
                        }
                    }
                }
                menu += `\n_Made with ❤️_`;
                await sock.sendMessage(remoteJid, { text: menu }, { quoted: msg });
                // Set menu state so user can reply with bare numbers
                if (customCmds.length > 0) setChatState(chatKey, "menu", Date.now() + 30 * 60_000);
                break;
            }

            // ===== GROUP: TAG ALL =====
            case "tagall":
            case "everyone": {
                if (!isGroupJid(remoteJid)) {
                    await sock.sendMessage(remoteJid, { text: "❌ Groups only." }, { quoted: msg });
                    return;
                }
                const metadata = await getGroupMetadataCached(sock, remoteJid);
                const parts = metadata.participants || [];
                const mentions = parts.map((p: any) => p.id);
                const note = args.join(" ").trim();
                let teks = note ? `${note}\n\n` : `📢 *Tag All* (${parts.length} members)\n\n`;
                for (const p of parts) teks += `• @${(p.id as string).split("@")[0]}\n`;
                await sock.sendMessage(remoteJid, { text: teks, mentions });
                break;
            }

            // ===== GROUP: HIDETAG (tag tersembunyi) =====
            case "hidetag":
            case "ht": {
                if (!isGroupJid(remoteJid)) {
                    await sock.sendMessage(remoteJid, { text: "❌ Groups only." }, { quoted: msg });
                    return;
                }
                const metadata = await getGroupMetadataCached(sock, remoteJid);
                const mentions = (metadata.participants || []).map((p: any) => p.id);
                const teks = args.join(" ").trim() || "📢";
                await sock.sendMessage(remoteJid, { text: teks, mentions });
                break;
            }

            // ===== GROUP: KICK =====
            case "kick": {
                const gate = await requireGroupAdmin(sock, remoteJid, msg, fromMe);
                if (!gate.ok) {
                    await sock.sendMessage(remoteJid, { text: gate.error! }, { quoted: msg });
                    return;
                }
                const targets = resolveTargetJids(msg, args);
                if (!targets.length) {
                    await sock.sendMessage(remoteJid, { text: `❌ Tag/reply the person, or type ${prefix}kick <number>.` }, { quoted: msg });
                    return;
                }
                try {
                    await sock.groupParticipantsUpdate(remoteJid, targets, "remove");
                    await sock.sendMessage(remoteJid, { text: `✅ Successfully kicked ${targets.length} members.`, mentions: targets }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(remoteJid, { text: `❌ Failed to kick: ${(e as any)?.message || e}` }, { quoted: msg });
                }
                break;
            }

            // ===== GROUP: ADD =====
            case "add": {
                const gate = await requireGroupAdmin(sock, remoteJid, msg, fromMe);
                if (!gate.ok) {
                    await sock.sendMessage(remoteJid, { text: gate.error! }, { quoted: msg });
                    return;
                }
                const targets = resolveTargetJids(msg, args);
                if (!targets.length) {
                    await sock.sendMessage(remoteJid, { text: `❌ Type ${prefix}add <number> (use country code, e.g. 628xxxx).` }, { quoted: msg });
                    return;
                }
                try {
                    const res: any = await sock.groupParticipantsUpdate(remoteJid, targets, "add");
                    const failed = Array.isArray(res) ? res.filter((r: any) => r.status !== "200") : [];
                    if (failed.length) {
                        await sock.sendMessage(remoteJid, { text: `⚠️ Partially failed to add (privacy settings/left group). Success: ${targets.length - failed.length}/${targets.length}.` }, { quoted: msg });
                    } else {
                        await sock.sendMessage(remoteJid, { text: `✅ Successfully added ${targets.length} members.` }, { quoted: msg });
                    }
                } catch (e) {
                    await sock.sendMessage(remoteJid, { text: `❌ Failed to add: ${(e as any)?.message || e}` }, { quoted: msg });
                }
                break;
            }

            // ===== GROUP: PROMOTE / DEMOTE =====
            case "promote":
            case "demote": {
                const gate = await requireGroupAdmin(sock, remoteJid, msg, fromMe);
                if (!gate.ok) {
                    await sock.sendMessage(remoteJid, { text: gate.error! }, { quoted: msg });
                    return;
                }
                const targets = resolveTargetJids(msg, args);
                if (!targets.length) {
                    await sock.sendMessage(remoteJid, { text: `❌ Tag/reply the person for ${prefix}${cmd}.` }, { quoted: msg });
                    return;
                }
                try {
                    await sock.groupParticipantsUpdate(remoteJid, targets, cmd === "promote" ? "promote" : "demote");
                    await sock.sendMessage(remoteJid, {
                        text: cmd === "promote" ? `✅ Promoted to admin.` : `✅ Demoted from admin.`,
                        mentions: targets
                    }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(remoteJid, { text: `❌ Failed: ${(e as any)?.message || e}` }, { quoted: msg });
                }
                break;
            }

            // ===== GROUP: OPEN / CLOSE (who can send messages) =====
            case "open":
            case "close":
            case "mute":
            case "unmute": {
                const gate = await requireGroupAdmin(sock, remoteJid, msg, fromMe);
                if (!gate.ok) {
                    await sock.sendMessage(remoteJid, { text: gate.error! }, { quoted: msg });
                    return;
                }
                const lock = cmd === "close" || cmd === "mute";
                try {
                    await sock.groupSettingUpdate(remoteJid, lock ? "announcement" : "not_announcement");
                    await sock.sendMessage(remoteJid, {
                        text: lock ? "🔒 Group closed — only admins can send messages." : "🔓 Group opened — all members can send messages."
                    }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(remoteJid, { text: `❌ Failed to change group settings: ${(e as any)?.message || e}` }, { quoted: msg });
                }
                break;
            }

            case "endchat": {
                await sock.sendMessage(remoteJid, { text: "ℹ️ No active live chat session." }, { quoted: msg });
                break;
            }

            default: {
                // Check custom commands
                const customCommands = Array.isArray((config as any).customCommands) ? (config as any).customCommands : [];
                const matched = customCommands.find((cc: any) => cc.command && cc.command.toLowerCase() === cmd);
                if (matched) {
                    if (matched.isLiveChat) {
                        const timeout = (config as any).liveChatTimeout || 30;
                        setChatState(chatKey, "livechat", Date.now() + timeout * 60_000);
                    } else if (Array.isArray(matched.subCommands) && matched.subCommands.length > 0) {
                        setChatState(chatKey, "submenu", Date.now() + 30 * 60_000, [matched.command.toLowerCase()]);
                    }
                    const replyText = Array.isArray(matched.subCommands) && matched.subCommands.length > 0
                        ? buildResponseWithSubMenu(matched.response, matched.subCommands, prefix)
                        : matched.response;
                    if (replyText) {
                        await sock.sendMessage(remoteJid, { text: replyText }, { quoted: msg });
                    }
                }
                break;
            }
        }
    } catch (e) {
        logger.error("Bot", "Bot command error", e);
    }
}

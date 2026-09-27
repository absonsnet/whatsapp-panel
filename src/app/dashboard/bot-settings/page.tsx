"use client";

import { useState, useEffect } from "react";
import { useSession as useSessionProvider } from "@/components/dashboard/session-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { RefreshCw, Save, AlertCircle, Bot, X, Plus, ShieldCheck, Zap, UserCheck, MessageSquarePlus, Terminal, ChevronUp, ChevronDown, Headphones } from "lucide-react";
import { toast } from "sonner";
import { SessionGuard } from "@/components/dashboard/session-guard";

interface CustomCommand {
    command: string;
    response: string;
    description: string;
    isLiveChat: boolean;
    isUniversal: boolean;
    subCommands: CustomCommand[];
}

interface UniversalCommand {
    command: string;
    action: string;
    description: string;
}

export default function BotSettingsPage() {
    const { sessionId } = useSessionProvider();

    const [botConfig, setBotConfig] = useState({
        enabled: true,
        botName: "WA-AKG Bot",
        prefix: "#",
        enableSticker: true,
        enableVideoSticker: true,
        maxStickerDuration: 10,
        enablePing: true,
        enableUptime: true,
        removeBgApiKey: "",
        botMode: "OWNER",
        autoReplyMode: "ALL",
        antiSpamEnabled: false,
        spamLimit: 5,
        spamInterval: 10,
        spamDelayMin: 1000,
        spamDelayMax: 3000,

        // New fields
        welcomeMessage: "",
        autoRead: false,
        alwaysOnline: false,
        botAllowedJids: [] as string[],
        botBlockedJids: [] as string[],
        autoReplyAllowedJids: [] as string[],
        autoReplyBlockedJids: [] as string[],

        // Anti-Link
        antiLinkMode: "OFF" as "OFF" | "INVITE" | "ALL",
        antiLinkAction: "DELETE" as "DELETE" | "KICK",
        antiLinkLimit: 3,
        antiLinkScope: "ALL" as "ALL" | "SPECIFIC",
        antiLinkGroups: [] as string[],

        // Custom Commands
        customCommands: [] as CustomCommand[],
        customMenuText: "",
        autoAppendCommands: true,
        liveChatTimeout: 30,
        universalCommands: [
            { command: "0", action: "MAIN_MENU", description: "Return to main menu" },
            { command: "back", action: "BACK", description: "Go back one level" },
        ] as UniversalCommand[],
    });
    const [botLoading, setBotLoading] = useState(false);

    const [newJid, setNewJid] = useState("");

    /** Deep-update a subCommand at a given path (array of indices). */
    const updateCommandAtPath = (path: number[], field: string, value: any) => {
        setBotConfig(prev => {
            const cmds = JSON.parse(JSON.stringify(prev.customCommands)) as CustomCommand[];
            let target: CustomCommand[] = cmds;
            for (let i = 0; i < path.length - 1; i++) {
                target = target[path[i]].subCommands || [];
            }
            (target[path[path.length - 1]] as any)[field] = value;
            return { ...prev, customCommands: cmds };
        });
    };

    const addSubCommandAtPath = (path: number[]) => {
        setBotConfig(prev => {
            const cmds = JSON.parse(JSON.stringify(prev.customCommands)) as CustomCommand[];
            let target: CustomCommand[] = cmds;
            for (const i of path) {
                target = target[i].subCommands = target[i].subCommands || [];
            }
            target.push({ command: '', response: '', description: '', isLiveChat: false, isUniversal: false, subCommands: [] });
            return { ...prev, customCommands: cmds };
        });
    };

    const removeSubCommandAtPath = (path: number[], idx: number) => {
        setBotConfig(prev => {
            const cmds = JSON.parse(JSON.stringify(prev.customCommands)) as CustomCommand[];
            let target: CustomCommand[] = cmds;
            for (const i of path) {
                target = target[i].subCommands = target[i].subCommands || [];
            }
            target.splice(idx, 1);
            return { ...prev, customCommands: cmds };
        });
    };

    /** Render sub-commands recursively, capped at maxDepth levels */
    const renderSubCommands = (parentPath: number[], subCommands: CustomCommand[], depth: number = 1, maxDepth: number = 6) => (
        <details className="border rounded-lg bg-background/50" style={{ marginLeft: `${Math.min(depth * 8, 32)}px` }}>
            <summary className="p-2.5 cursor-pointer select-none text-xs font-medium hover:bg-muted/30 rounded-lg transition-colors flex items-center justify-between">
                <span>Sub-Commands ({subCommands.length})</span>
                <span className="text-[10px] text-muted-foreground">Level {depth}</span>
            </summary>
            <div className="p-3 space-y-2 border-t">
                {subCommands.map((sc, sIdx) => (
                    <div key={sIdx} className="space-y-1">
                        <div className="grid grid-cols-[1fr_1fr_2fr_auto] gap-2 items-start">
                            <Input placeholder="cmd" className="text-xs h-8" value={sc.command}
                                onChange={(e) => updateCommandAtPath([...parentPath, sIdx], 'command', e.target.value.replace(/\s/g, '').toLowerCase())} />
                            <Input placeholder="description" className="text-xs h-8" value={sc.description}
                                onChange={(e) => updateCommandAtPath([...parentPath, sIdx], 'description', e.target.value)} />
                            <Input placeholder="response text" className="text-xs h-8" value={sc.response}
                                onChange={(e) => updateCommandAtPath([...parentPath, sIdx], 'response', e.target.value)} />
                            <button type="button" className="text-muted-foreground hover:text-destructive transition-colors h-8 px-1"
                                onClick={() => removeSubCommandAtPath(parentPath, sIdx)}>
                                <X className="h-3.5 w-3.5" />
                            </button>
                        </div>
                        {/* Recursive sub-commands */}
                        {depth < maxDepth && (
                            <>
                                {(sc.subCommands || []).length > 0 && renderSubCommands([...parentPath, sIdx], sc.subCommands || [], depth + 1, maxDepth)}
                                <Button type="button" variant="outline" size="sm" className="w-full border-dashed text-[10px] h-6"
                                    disabled={!sc.command.trim()}
                                    onClick={() => addSubCommandAtPath([...parentPath, sIdx])}>
                                    <Plus className="h-3 w-3 mr-1" /> {(sc.subCommands || []).length > 0 ? 'Add Another Sub-Command' : 'Add Sub-Commands (Nested Menu)'}
                                </Button>
                            </>
                        )}
                    </div>
                ))}
                <Button type="button" variant="outline" size="sm" className="w-full border-dashed text-xs h-7"
                    onClick={() => addSubCommandAtPath(parentPath)}>
                    <Plus className="h-3 w-3 mr-1" /> Add Sub-Command
                </Button>
                <p className="text-[10px] text-muted-foreground">Type <strong>back</strong> to go up one level, <strong>0</strong> to return to main menu.</p>
            </div>
        </details>
    );


    const [privacyConfig, setPrivacyConfig] = useState({
        ghostMode: false,
        antiDelete: false,
        readReceipts: true,
    });
    const [privacyLoading, setPrivacyLoading] = useState(false);
    const [groupsList, setGroupsList] = useState<Array<{ jid: string; subject: string | null }>>([]);
    const [groupSearch, setGroupSearch] = useState("");
    const [groupsRefreshing, setGroupsRefreshing] = useState(false);

    const fetchGroupsList = async (forceRefresh = false) => {
        if (!sessionId) return;
        try {
            if (forceRefresh) setGroupsRefreshing(true);
            const url = `/api/groups/${sessionId}${forceRefresh ? "?refresh=1" : ""}`;
            const res = await fetch(url);
            const data = await res.json();
            if (data.status) {
                setGroupsList(
                    (data.data || []).map((g: any) => ({ jid: g.jid, subject: g.subject || null }))
                );
            }
            if (forceRefresh) toast.success("Group list refreshed");
        } catch {
            if (forceRefresh) toast.error("Failed to refresh groups");
        } finally {
            if (forceRefresh) setGroupsRefreshing(false);
        }
    };

    useEffect(() => {
        if (!sessionId) return;
        fetchGroupsList();

        fetch(`/api/sessions/${sessionId}/bot-config`)
            .then(res => { if (!res.ok) throw new Error(); return res.json(); })
            .then(responseData => {
                const data = responseData?.data;
                if (data && !responseData.error) {
                    setBotConfig(prev => ({
                        ...prev,
                        ...data,
                        removeBgApiKey: data.removeBgApiKey || "",
                        prefix: data.prefix ?? "#",
                        welcomeMessage: data.welcomeMessage || "",
                        botAllowedJids: data.botAllowedJids || [],
                        botBlockedJids: data.botBlockedJids || [],
                        autoReplyAllowedJids: data.autoReplyAllowedJids || [],
                        autoReplyBlockedJids: data.autoReplyBlockedJids || [],
                        antiLinkGroups: data.antiLinkGroups || [],
                        customCommands: (data.customCommands || []).map((cc: any) => ({ ...cc, subCommands: cc.subCommands || [] })),
                        customMenuText: data.customMenuText || "",
                        autoAppendCommands: data.autoAppendCommands ?? true,
                        liveChatTimeout: data.liveChatTimeout ?? 30,
                        universalCommands: data.universalCommands || [
                            { command: "0", action: "MAIN_MENU", description: "Return to main menu" },
                            { command: "back", action: "BACK", description: "Go back one level" },
                        ],
                    }));
                }
            })
            .catch(() => { });

        fetch(`/api/sessions/${sessionId}/settings`)
            .then(res => { if (!res.ok) throw new Error(); return res.json(); })
            .then(responseData => {
                const data = responseData?.data;
                if (data && !responseData.error) {
                    setPrivacyConfig({
                        ghostMode: data.config?.ghostMode || false,
                        antiDelete: data.config?.antiDelete || false,
                        readReceipts: data.config?.readReceipts ?? true
                    });
                }
            })
            .catch(() => { });
    }, [sessionId]);

    const BUILTIN_COMMANDS = ["ping", "sticker", "s", "menu", "help", "id", "uptime", "tagall", "everyone", "hidetag", "kick", "add", "promote", "demote", "open", "close", "mute", "unmute", "endchat"];

    /** Collect all command names recursively from custom commands */
    const collectCommandNames = (cmds: CustomCommand[], prefix: string = ""): string[] => {
        const names: string[] = [];
        for (const c of cmds) {
            if (c.command) names.push(prefix ? `${prefix} → ${c.command}` : c.command);
            if (c.subCommands?.length) names.push(...collectCommandNames(c.subCommands, c.command));
        }
        return names;
    };

    const handleSaveBot = async () => {
        if (!sessionId) return;

        // Conflict detection — scoped validation
        const warnings: string[] = [];
        const uniNames = (botConfig.universalCommands || []).map((uc: any) => uc.command?.toLowerCase()).filter(Boolean);

        // Validate top-level commands: no dups among themselves, no conflicts with built-in or universal commands
        const topLevelNames = botConfig.customCommands.filter(c => c.command).map(c => c.command.toLowerCase());
        const topSeen = new Set<string>();
        for (const name of topLevelNames) {
            if (topSeen.has(name)) warnings.push(`Top-level command "${name}" is duplicated`);
            topSeen.add(name);
            if (BUILTIN_COMMANDS.includes(name)) warnings.push(`"${name}" conflicts with built-in command`);
            if (uniNames.includes(name)) warnings.push(`"${name}" conflicts with universal command`);
        }

        // Validate sub-commands at each level: siblings must not conflict with each other or universal commands
        const validateSubCommands = (cmds: CustomCommand[], parentLabel: string) => {
            const siblingNames = cmds.filter(c => c.command).map(c => c.command.toLowerCase());
            const sibSeen = new Set<string>();
            for (const name of siblingNames) {
                if (sibSeen.has(name)) warnings.push(`Sub-command "${name}" under "${parentLabel}" is duplicated`);
                sibSeen.add(name);
                if (uniNames.includes(name)) warnings.push(`Sub-command "${name}" under "${parentLabel}" conflicts with universal command`);
            }
            for (const sc of cmds) {
                if (sc.subCommands?.length) validateSubCommands(sc.subCommands, `${parentLabel} → ${sc.command}`);
            }
        };
        for (const cc of botConfig.customCommands) {
            if (cc.subCommands?.length) validateSubCommands(cc.subCommands, cc.command);
        }

        if (warnings.length > 0) {
            toast.error(`Cannot save — command conflicts found:\n${warnings.join("\n")}`);
            return;
        }

        setBotLoading(true);
        try {
            const res = await fetch(`/api/sessions/${sessionId}/bot-config`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(botConfig)
            });

            if (res.ok) {
                toast.success("Bot configuration saved");
            } else {
                toast.error("Failed to save bot configuration");
            }
        } catch (e) {
            console.error(e);
            toast.error("Error saving bot configuration");
        } finally {
            setBotLoading(false);
        }
    };

    const handleSavePrivacy = async () => {
        if (!sessionId) return;
        setPrivacyLoading(true);
        try {
            const res = await fetch(`/api/sessions/${sessionId}/settings`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    config: {
                        ghostMode: privacyConfig.ghostMode,
                        antiDelete: privacyConfig.antiDelete,
                        readReceipts: privacyConfig.readReceipts
                    }
                })
            });

            if (res.ok) {
                toast.success("Privacy settings saved");
            } else {
                const data = await res.json().catch(() => ({}));
                toast.error(data.message || "Failed to save privacy settings");
            }
        } catch (e) {
            console.error(e);
            toast.error("Error saving privacy settings");
        } finally {
            setPrivacyLoading(false);
        }
    };

    const addJid = (listName: 'botAllowedJids' | 'botBlockedJids' | 'autoReplyAllowedJids' | 'autoReplyBlockedJids') => {
        if (!newJid || !newJid.trim()) return;
        let formatted = newJid.trim();
        if (!formatted.includes('@')) formatted += '@s.whatsapp.net';

        if (!botConfig[listName].includes(formatted)) {
            setBotConfig(prev => ({
                ...prev,
                [listName]: [...prev[listName], formatted]
            }));
        }
        setNewJid("");
    };

    const removeJid = (listName: 'botAllowedJids' | 'botBlockedJids' | 'autoReplyAllowedJids' | 'autoReplyBlockedJids', jid: string) => {
        setBotConfig(prev => ({
            ...prev,
            [listName]: prev[listName].filter(item => item !== jid)
        }));
    };

    const inputClass = "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

    return (
        <SessionGuard>
            <div className="space-y-6">
                <div>
                    <h2 className="text-xl sm:text-3xl font-bold tracking-tight">Bot Settings</h2>
                    <p className="text-muted-foreground text-sm mt-1">Configure bot features and session privacy for the active WhatsApp session.</p>
                </div>

                {/* Bot Mode & Access Section */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <ShieldCheck className="h-5 w-5 text-primary" />
                            Bot Mode & Access Control
                        </CardTitle>
                        <CardDescription>Configure who can interact with the bot and use commands.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                            {/* Master toggle — when off, ALL bot features (commands, auto-reply) are paused */}
                            <div className="flex items-center justify-between gap-4 rounded-lg border p-3 bg-muted/20">
                                <div className="space-y-0.5">
                                    <Label htmlFor="bot-enabled" className="text-sm font-semibold cursor-pointer">
                                        Bot Enabled
                                    </Label>
                                    <p className="text-xs text-muted-foreground">
                                        Master switch — when off, the bot ignores all commands and auto-replies for this session.
                                    </p>
                                </div>
                                <Switch
                                    id="bot-enabled"
                                    checked={botConfig.enabled}
                                    onCheckedChange={c => setBotConfig(prev => ({ ...prev, enabled: c }))}
                                />
                            </div>

                            <div className="grid gap-2">
                                <Label>Bot Name</Label>
                                <Input
                                    placeholder="WA-AKG Bot"
                                    value={botConfig.botName}
                                    onChange={(e) => setBotConfig(prev => ({ ...prev, botName: e.target.value }))}
                                />
                                <p className="text-xs text-muted-foreground">The display name used by the bot in automated responses.</p>
                            </div>

                            <div className="grid sm:grid-cols-2 gap-4">
                                <div className="grid gap-2">
                                    <Label>Command Prefix</Label>
                                    <Input
                                        className="max-w-[100px]"
                                        placeholder="#"
                                        maxLength={3}
                                        value={botConfig.prefix}
                                        onChange={(e) => setBotConfig(prev => ({ ...prev, prefix: e.target.value }))}
                                    />
                                    <p className="text-xs text-muted-foreground">The prefix character for bot commands.</p>
                                </div>
                                <div className="grid gap-2">
                                    <Label>Bot Interaction Mode</Label>
                                    <Select
                                        value={botConfig.botMode}
                                        onValueChange={(v: any) => setBotConfig(prev => ({ ...prev, botMode: v }))}
                                    >
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select Mode" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="ALL">Public (Everyone)</SelectItem>
                                            <SelectItem value="OWNER">Private (Owner Only)</SelectItem>
                                            <SelectItem value="SPECIFIC">Whitelist (Selected JIDs)</SelectItem>
                                            <SelectItem value="BLACKLIST">Blacklist (Block JIDs)</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <p className="text-xs text-muted-foreground">Control who can trigger bot commands.</p>
                                </div>
                            </div>

                            {(botConfig.botMode === 'SPECIFIC' || botConfig.botMode === 'BLACKLIST') && (
                                <div className="space-y-4 pt-4 border-t border-border/50 animate-in fade-in slide-in-from-top-1 duration-200">
                                    <Label className="flex items-center gap-2">
                                        <UserCheck className="h-4 w-4" />
                                        {botConfig.botMode === 'SPECIFIC' ? "Whitelisted Numbers" : "Blacklisted Numbers"}
                                    </Label>
                                    <div className="flex gap-2">
                                        <Input
                                            placeholder="628123456789@s.whatsapp.net"
                                            value={newJid}
                                            onChange={(e) => setNewJid(e.target.value)}
                                            onKeyDown={(e) => e.key === 'Enter' && addJid(botConfig.botMode === 'SPECIFIC' ? 'botAllowedJids' : 'botBlockedJids')}
                                        />
                                        <Button variant="outline" size="icon" onClick={() => addJid(botConfig.botMode === 'SPECIFIC' ? 'botAllowedJids' : 'botBlockedJids')}>
                                            <Plus className="h-4 w-4" />
                                        </Button>
                                    </div>
                                    <div className="flex flex-wrap gap-2 mt-2">
                                        {(botConfig.botMode === 'SPECIFIC' ? botConfig.botAllowedJids : botConfig.botBlockedJids).map(jid => (
                                            <div key={jid} className="flex items-center gap-1.5 bg-secondary text-secondary-foreground px-2 py-1 rounded-md text-xs font-medium">
                                                {jid}
                                                <button onClick={() => removeJid(botConfig.botMode === 'SPECIFIC' ? 'botAllowedJids' : 'botBlockedJids', jid)} className="text-muted-foreground hover:text-destructive transition-colors">
                                                    <X className="h-3 w-3" />
                                                </button>
                                            </div>
                                        ))}
                                        {(botConfig.botMode === 'SPECIFIC' ? botConfig.botAllowedJids : botConfig.botBlockedJids).length === 0 && (
                                            <p className="text-xs text-muted-foreground italic">No numbers added yet.</p>
                                        )}
                                    </div>
                                </div>
                            )}

                            <div className="grid sm:grid-cols-2 gap-4 pt-4 border-t border-border/50">
                                <div className="flex items-center justify-between space-x-2 border p-3 rounded-lg">
                                    <Label htmlFor="enable-ping" className="flex flex-col space-y-1 cursor-pointer">
                                        <span className="font-medium">Ping Command</span>
                                        <span className="font-normal text-[10px] text-muted-foreground">Respond to {botConfig.prefix}ping</span>
                                    </Label>
                                    <Switch id="enable-ping" checked={botConfig.enablePing}
                                        onCheckedChange={c => setBotConfig(prev => ({ ...prev, enablePing: c }))} />
                                </div>
                                <div className="flex items-center justify-between space-x-2 border p-3 rounded-lg">
                                    <Label htmlFor="enable-uptime" className="flex flex-col space-y-1 cursor-pointer">
                                        <span className="font-medium">Uptime Command</span>
                                        <span className="font-normal text-[10px] text-muted-foreground">Respond to {botConfig.prefix}uptime</span>
                                    </Label>
                                    <Switch id="enable-uptime" checked={botConfig.enableUptime}
                                        onCheckedChange={c => setBotConfig(prev => ({ ...prev, enableUptime: c }))} />
                                </div>
                            </div>

                            <div className="pt-2">
                                <Button className="w-full sm:w-auto" onClick={handleSaveBot} disabled={botLoading || !sessionId}>
                                    {botLoading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                    Save Bot Configuration
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Automation & Presence Section */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Zap className="h-5 w-5 text-yellow-500" />
                                Automation & Presence
                            </CardTitle>
                            <CardDescription>Advanced bot automation and presence customization.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="grid sm:grid-cols-2 gap-4">
                                <div className="flex items-center justify-between space-x-2 border p-3 rounded-lg">
                                    <Label htmlFor="always-online" className="flex flex-col space-y-1 cursor-pointer">
                                        <span className="font-medium">Always Online</span>
                                        <span className="font-normal text-[10px] text-muted-foreground">Stay "Online" even when inactive.</span>
                                    </Label>
                                    <Switch id="always-online" checked={botConfig.alwaysOnline}
                                        onCheckedChange={c => setBotConfig(prev => ({ ...prev, alwaysOnline: c }))} />
                                </div>
                                <div className="flex items-center justify-between space-x-2 border p-3 rounded-lg">
                                    <Label htmlFor="auto-read" className="flex flex-col space-y-1 cursor-pointer">
                                        <span className="font-medium">Auto Read (Blue Ticks)</span>
                                        <span className="font-normal text-[10px] text-muted-foreground">Automatically mark messages as read.</span>
                                    </Label>
                                    <Switch id="auto-read" checked={botConfig.autoRead}
                                        onCheckedChange={c => setBotConfig(prev => ({ ...prev, autoRead: c }))} />
                                </div>
                            </div>

                            <div className="space-y-2 border-t border-border/50 pt-4">
                                <Label className="flex items-center gap-2">
                                    <MessageSquarePlus className="h-4 w-4 text-primary" />
                                    Welcome Message (Beta)
                                </Label>
                                <Textarea
                                    placeholder="Hello! Welcome to our WhatsApp Bot. How can I help you today?"
                                    className="min-h-[100px]"
                                    value={botConfig.welcomeMessage}
                                    onChange={(e) => setBotConfig(prev => ({ ...prev, welcomeMessage: e.target.value }))}
                                />
                                <p className="text-[10px] text-muted-foreground">Sent automatically to users when they message this bot for the first time.</p>
                            </div>

                            <div className="pt-2">
                                <Button className="w-full sm:w-auto" onClick={handleSaveBot} disabled={botLoading || !sessionId}>
                                    {botLoading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                    Save Automation Settings
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Media & Stickers Section */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Media & Stickers</CardTitle>
                            <CardDescription>Configure how the bot handles media and sticker conversion.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="grid sm:grid-cols-2 gap-4">
                                <div className="flex items-center justify-between space-x-2 border p-3 rounded-lg">
                                    <Label htmlFor="enable-sticker" className="flex flex-col space-y-1 cursor-pointer">
                                        <span className="font-medium">Image to Sticker</span>
                                        <span className="font-normal text-xs text-muted-foreground">Auto-convert images</span>
                                    </Label>
                                    <Switch id="enable-sticker" checked={botConfig.enableSticker}
                                        onCheckedChange={c => setBotConfig(prev => ({ ...prev, enableSticker: c }))} />
                                </div>
                                <div className="flex items-center justify-between space-x-2 border p-3 rounded-lg">
                                    <Label htmlFor="enable-video-sticker" className="flex flex-col space-y-1 cursor-pointer">
                                        <span className="font-medium">Video to Sticker</span>
                                        <span className="font-normal text-xs text-muted-foreground">Auto-convert short videos</span>
                                    </Label>
                                    <Switch id="enable-video-sticker" checked={botConfig.enableVideoSticker}
                                        onCheckedChange={c => setBotConfig(prev => ({ ...prev, enableVideoSticker: c }))} />
                                </div>
                            </div>

                            <div className="grid gap-2 border-t border-border/50 pt-4">
                                <Label>Max Sticker Video Duration: <strong>{botConfig.maxStickerDuration}s</strong></Label>
                                <Slider
                                    value={[botConfig.maxStickerDuration]}
                                    onValueChange={([v]) => setBotConfig(prev => ({ ...prev, maxStickerDuration: v }))}
                                    min={3}
                                    max={30}
                                    step={1}
                                />
                                <p className="text-xs text-muted-foreground">Maximum video duration (in seconds) allowed for sticker conversion.</p>
                            </div>

                            <div className="grid gap-2 border-t border-border/50 pt-4">
                                <Label>Remove.bg API Key (Optional)</Label>
                                <Input
                                    type="password"
                                    placeholder="Enter your Remove.bg API Key"
                                    value={botConfig.removeBgApiKey || ""}
                                    onChange={(e) => setBotConfig(prev => ({ ...prev, removeBgApiKey: e.target.value }))}
                                />
                                <p className="text-xs text-muted-foreground">Enables background removal for stickers (use <code className="bg-muted px-1 rounded">nobg</code> caption).</p>
                            </div>

                            <div className="pt-2">
                                <Button className="w-full sm:w-auto" onClick={handleSaveBot} disabled={botLoading || !sessionId}>
                                    {botLoading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                    Save Media Settings
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Anti-Ban Protection */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <AlertCircle className="h-5 w-5 text-orange-500" />
                                Anti-Ban Protection (Beta)
                            </CardTitle>
                            <CardDescription>
                                Prevent your WhatsApp number from being detected as spam or banned by adding intelligent random delays between outgoing messages. This applies to <strong>all</strong> actions: bot replies, auto-replies, broadcasts, scheduled messages, and API calls for this session.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="flex items-center justify-between space-x-2 border p-3 rounded-lg bg-orange-500/5 border-orange-500/20">
                                <Label htmlFor="anti-spam" className="flex flex-col space-y-1">
                                    <span className="font-semibold text-orange-700 dark:text-orange-400">Enable Anti-Spam Delay</span>
                                    <span className="font-normal text-xs text-muted-foreground">When enabled, messages will be queued and sent with a random delay if the rate limit is reached. Messages are never rejected — only delayed.</span>
                                </Label>
                                <Switch id="anti-spam" checked={botConfig.antiSpamEnabled}
                                    onCheckedChange={c => setBotConfig(prev => ({ ...prev, antiSpamEnabled: c }))} />
                            </div>

                            {botConfig.antiSpamEnabled && (
                                <div className="grid gap-6 animate-in fade-in slide-in-from-top-1 duration-200">
                                    {/* How it works */}
                                    <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-4 space-y-2">
                                        <p className="text-sm font-semibold text-blue-700 dark:text-blue-400">💡 How it works</p>
                                        <p className="text-xs text-muted-foreground leading-relaxed">
                                            The system tracks how many messages this session sends within a time window.
                                            If the number of messages exceeds the <strong>threshold</strong> within the <strong>time window</strong>,
                                            each subsequent message will be <strong>delayed</strong> by a random amount between <strong>Min</strong> and <strong>Max</strong> delay.
                                            Once the time window resets (old messages expire), messages go back to normal speed.
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            <strong>Example:</strong> With threshold = <strong>{botConfig.spamLimit}</strong> and window = <strong>{botConfig.spamInterval}s</strong> →
                                            the first {botConfig.spamLimit} messages within {botConfig.spamInterval} seconds are sent instantly.
                                            Message #{botConfig.spamLimit + 1} and beyond will be delayed by {botConfig.spamDelayMin}ms–{botConfig.spamDelayMax}ms each.
                                        </p>
                                    </div>

                                    <div className="grid sm:grid-cols-2 gap-4">
                                        <div className="grid gap-2">
                                            <Label className="font-semibold">Messages Threshold</Label>
                                            <Input
                                                type="number"
                                                value={botConfig.spamLimit}
                                                onChange={e => setBotConfig(prev => ({ ...prev, spamLimit: parseInt(e.target.value) || 1 }))}
                                                min={1}
                                            />
                                            <p className="text-xs text-muted-foreground">
                                                Number of messages allowed at full speed before delay kicks in.
                                                <span className="text-orange-600 dark:text-orange-400"> Lower = safer but slower.</span>
                                            </p>
                                        </div>
                                        <div className="grid gap-2">
                                            <Label className="font-semibold">Time Window (Seconds)</Label>
                                            <Input
                                                type="number"
                                                value={botConfig.spamInterval}
                                                onChange={e => setBotConfig(prev => ({ ...prev, spamInterval: parseInt(e.target.value) || 1 }))}
                                                min={1}
                                            />
                                            <p className="text-xs text-muted-foreground">
                                                The rolling window to count messages. After this time passes, the counter resets naturally.
                                                <span className="text-orange-600 dark:text-orange-400"> Longer = more conservative.</span>
                                            </p>
                                        </div>
                                    </div>

                                    <div className="grid sm:grid-cols-2 gap-4">
                                        <div className="grid gap-2">
                                            <Label className="font-semibold">Min Delay (ms)</Label>
                                            <Input
                                                type="number"
                                                value={botConfig.spamDelayMin}
                                                onChange={e => setBotConfig(prev => ({ ...prev, spamDelayMin: parseInt(e.target.value) || 0 }))}
                                                min={0}
                                                step={100}
                                            />
                                            <p className="text-xs text-muted-foreground">
                                                Minimum random delay applied. 1000ms = 1 second.
                                            </p>
                                        </div>
                                        <div className="grid gap-2">
                                            <Label className="font-semibold">Max Delay (ms)</Label>
                                            <Input
                                                type="number"
                                                value={botConfig.spamDelayMax}
                                                onChange={e => setBotConfig(prev => ({ ...prev, spamDelayMax: parseInt(e.target.value) || 0 }))}
                                                min={0}
                                                step={100}
                                            />
                                            <p className="text-xs text-muted-foreground">
                                                Maximum random delay applied. 3000ms = 3 seconds.
                                            </p>
                                        </div>
                                    </div>

                                    <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-3">
                                        <p className="text-xs text-muted-foreground">
                                            ⚠️ <strong>Recommended safe settings:</strong> Threshold <strong>5</strong>, Window <strong>10s</strong>, Delay <strong>1000–3000ms</strong>.
                                            For high-volume broadcasts, use Threshold <strong>3</strong> with Delay <strong>2000–5000ms</strong>.
                                        </p>
                                    </div>
                                </div>
                            )}

                            <div className="pt-2">
                                <Button onClick={handleSaveBot} disabled={botLoading || !sessionId}>
                                    {botLoading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                    Save Protection Settings
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Anti-Link (Group) */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Anti-Link (Group)</CardTitle>
                            <CardDescription>
                                Auto-delete messages containing links in groups. Bot must be group admin to enforce.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid sm:grid-cols-2 gap-4">
                                <div className="grid gap-2">
                                    <Label>Mode</Label>
                                    <Select
                                        value={botConfig.antiLinkMode}
                                        onValueChange={(v) =>
                                            setBotConfig((p) => ({ ...p, antiLinkMode: v as any }))
                                        }
                                    >
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="OFF">Off</SelectItem>
                                            <SelectItem value="INVITE">Block WA invite links only</SelectItem>
                                            <SelectItem value="ALL">Block ALL links</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <p className="text-xs text-muted-foreground">
                                        <code>INVITE</code> blocks <code>chat.whatsapp.com/...</code>. <code>ALL</code> blocks any URL.
                                    </p>
                                </div>

                                <div className="grid gap-2">
                                    <Label>Action</Label>
                                    <Select
                                        value={botConfig.antiLinkAction}
                                        onValueChange={(v) =>
                                            setBotConfig((p) => ({ ...p, antiLinkAction: v as any }))
                                        }
                                        disabled={botConfig.antiLinkMode === "OFF"}
                                    >
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="DELETE">Delete + Warn</SelectItem>
                                            <SelectItem value="KICK">Warn then Kick after limit</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            {botConfig.antiLinkAction === "KICK" && botConfig.antiLinkMode !== "OFF" && (
                                <div className="grid gap-2 max-w-[200px]">
                                    <Label>Warn Limit</Label>
                                    <Input
                                        type="number"
                                        min={1}
                                        max={10}
                                        value={botConfig.antiLinkLimit}
                                        onChange={(e) =>
                                            setBotConfig((p) => ({
                                                ...p,
                                                antiLinkLimit: Math.max(1, Math.min(10, Number(e.target.value) || 3)),
                                            }))
                                        }
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        Kick after this many warnings.
                                    </p>
                                </div>
                            )}

                            {/* Scope: ALL groups vs SPECIFIC */}
                            {botConfig.antiLinkMode !== "OFF" && (
                                <div className="grid gap-2">
                                    <Label>Apply To</Label>
                                    <Select
                                        value={botConfig.antiLinkScope}
                                        onValueChange={(v) =>
                                            setBotConfig((p) => ({ ...p, antiLinkScope: v as any }))
                                        }
                                    >
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="ALL">All groups</SelectItem>
                                            <SelectItem value="SPECIFIC">Selected groups only</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}

                            {/* Group picker — only when scope=SPECIFIC */}
                            {botConfig.antiLinkMode !== "OFF" && botConfig.antiLinkScope === "SPECIFIC" && (
                                <div className="grid gap-2">
                                    <div className="flex items-center justify-between gap-2 flex-wrap">
                                        <Label>Active Groups ({botConfig.antiLinkGroups.length} selected)</Label>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() => fetchGroupsList(true)}
                                            disabled={groupsRefreshing}
                                        >
                                            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${groupsRefreshing ? "animate-spin" : ""}`} />
                                            Refresh
                                        </Button>
                                    </div>
                                    <Input
                                        placeholder="Search groups..."
                                        value={groupSearch}
                                        onChange={(e) => setGroupSearch(e.target.value)}
                                    />
                                    <div className="max-h-56 overflow-y-auto border rounded-lg p-2 space-y-1 bg-muted/20">
                                        {groupsList.length === 0 ? (
                                            <p className="text-xs text-muted-foreground text-center py-3">
                                                No groups found. Click Refresh to sync from WhatsApp.
                                            </p>
                                        ) : (
                                            groupsList
                                                .filter((g) =>
                                                    !groupSearch ||
                                                    (g.subject || g.jid).toLowerCase().includes(groupSearch.toLowerCase())
                                                )
                                                .map((g) => {
                                                    const checked = botConfig.antiLinkGroups.includes(g.jid);
                                                    return (
                                                        <label
                                                            key={g.jid}
                                                            className={`flex items-center gap-2 p-2 rounded cursor-pointer text-sm hover:bg-muted ${checked ? "bg-primary/10 border border-primary/30" : ""}`}
                                                        >
                                                            <input
                                                                type="checkbox"
                                                                checked={checked}
                                                                onChange={(e) => {
                                                                    setBotConfig((p) => ({
                                                                        ...p,
                                                                        antiLinkGroups: e.target.checked
                                                                            ? [...p.antiLinkGroups, g.jid]
                                                                            : p.antiLinkGroups.filter((x) => x !== g.jid),
                                                                    }));
                                                                }}
                                                                className="shrink-0"
                                                            />
                                                            <span className="truncate">{g.subject || g.jid}</span>
                                                        </label>
                                                    );
                                                })
                                        )}
                                    </div>
                                </div>
                            )}

                            <p className="text-xs text-muted-foreground border-l-2 border-amber-500/50 pl-3 py-1 bg-amber-500/5 rounded">
                                ℹ️ Group admins are exempt. Bot must be admin to delete or kick.
                            </p>

                            <div className="pt-2">
                                <Button onClick={handleSaveBot} disabled={botLoading || !sessionId}>
                                    {botLoading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                    Save Anti-Link Settings
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Custom Bot Commands */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Terminal className="h-5 w-5 text-emerald-500" />
                                Custom Bot Commands
                            </CardTitle>
                            <CardDescription>
                                Define your own commands (e.g. <code className="bg-muted px-1 rounded">{botConfig.prefix}info</code>, <code className="bg-muted px-1 rounded">{botConfig.prefix}aims</code>) that appear in the <code className="bg-muted px-1 rounded">{botConfig.prefix}help</code> menu.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <Label className="font-semibold">Menu Description / Header</Label>
                                <Textarea
                                    placeholder={`Leave empty to use the default auto-generated menu.\n\nExample:\n🤖 *My Bot* 🤖\n\n📌 *Available Commands:*`}
                                    className="min-h-[120px] font-mono text-sm"
                                    value={botConfig.customMenuText}
                                    onChange={(e) => setBotConfig(prev => ({ ...prev, customMenuText: e.target.value }))}
                                />
                                <p className="text-[10px] text-muted-foreground">
                                    This text is used as the menu header on <code className="bg-muted px-1 rounded">{botConfig.prefix}help</code>. Leave empty to use the default built-in menu. Supports WhatsApp formatting (*bold*, _italic_).
                                </p>
                            </div>

                            <div className="flex items-center justify-between space-x-2 border p-3 rounded-lg">
                                <Label htmlFor="auto-append-cmds" className="flex flex-col space-y-1 cursor-pointer">
                                    <span className="font-medium">Auto-Append Commands to Menu</span>
                                    <span className="font-normal text-[10px] text-muted-foreground">When enabled, custom commands below are automatically listed in the {botConfig.prefix}help menu. Disable if you want full control over the menu text above.</span>
                                </Label>
                                <Switch id="auto-append-cmds" checked={botConfig.autoAppendCommands}
                                    onCheckedChange={c => setBotConfig(prev => ({ ...prev, autoAppendCommands: c }))} />
                            </div>

                            {botConfig.customCommands.map((cc, idx) => (
                                <details key={idx} className="border rounded-lg bg-muted/10 group" open={!cc.command}>
                                    <summary className="flex items-center justify-between p-3 cursor-pointer select-none hover:bg-muted/30 rounded-lg transition-colors">
                                        <span className="text-sm font-medium flex items-center gap-2">
                                            {cc.isLiveChat && <Headphones className="h-3.5 w-3.5 text-blue-500" />}
                                            {cc.command ? <><code className="bg-muted px-1.5 py-0.5 rounded">{botConfig.prefix}{cc.command}</code>{cc.description && <span className="text-muted-foreground">— {cc.description}</span>}</> : <span className="text-muted-foreground italic">New command (expand to edit)</span>}
                                        </span>
                                        <div className="flex items-center gap-1 ml-2 shrink-0">
                                            <button type="button" className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30" disabled={idx === 0}
                                                onClick={(e) => { e.preventDefault(); const u = [...botConfig.customCommands]; [u[idx-1], u[idx]] = [u[idx], u[idx-1]]; setBotConfig(p => ({...p, customCommands: u})); }}>
                                                <ChevronUp className="h-4 w-4" />
                                            </button>
                                            <button type="button" className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30" disabled={idx === botConfig.customCommands.length - 1}
                                                onClick={(e) => { e.preventDefault(); const u = [...botConfig.customCommands]; [u[idx], u[idx+1]] = [u[idx+1], u[idx]]; setBotConfig(p => ({...p, customCommands: u})); }}>
                                                <ChevronDown className="h-4 w-4" />
                                            </button>
                                            <button type="button" className="text-muted-foreground hover:text-destructive transition-colors ml-1"
                                                onClick={(e) => { e.preventDefault(); setBotConfig(p => ({...p, customCommands: p.customCommands.filter((_, i) => i !== idx)})); }}>
                                                <X className="h-4 w-4" />
                                            </button>
                                        </div>
                                    </summary>
                                    <div className="p-4 pt-2 space-y-3 border-t">
                                        <div className="grid sm:grid-cols-2 gap-3">
                                            <div className="grid gap-1">
                                                <Label className="text-xs">Command (without prefix)</Label>
                                                <Input
                                                    placeholder="e.g. 1, info, aims"
                                                    value={cc.command}
                                                    onChange={(e) => {
                                                        const updated = [...botConfig.customCommands];
                                                        updated[idx] = { ...updated[idx], command: e.target.value.replace(/\s/g, '').toLowerCase() };
                                                        setBotConfig(prev => ({ ...prev, customCommands: updated }));
                                                    }}
                                                />
                                            </div>
                                            <div className="grid gap-1">
                                                <Label className="text-xs">Menu Description (optional)</Label>
                                                <Input
                                                    placeholder="e.g. Show company info"
                                                    value={cc.description}
                                                    onChange={(e) => {
                                                        const updated = [...botConfig.customCommands];
                                                        updated[idx] = { ...updated[idx], description: e.target.value };
                                                        setBotConfig(prev => ({ ...prev, customCommands: updated }));
                                                    }}
                                                />
                                            </div>
                                        </div>
                                        <div className="grid gap-1">
                                            <Label className="text-xs">Response Message</Label>
                                            <Textarea
                                                placeholder="The text the bot will reply with..."
                                                className="min-h-[80px]"
                                                value={cc.response}
                                                onChange={(e) => {
                                                    const updated = [...botConfig.customCommands];
                                                    updated[idx] = { ...updated[idx], response: e.target.value };
                                                    setBotConfig(prev => ({ ...prev, customCommands: updated }));
                                                }}
                                            />
                                        </div>
                                        <div className="flex items-center justify-between space-x-2 border p-3 rounded-lg bg-blue-500/5 border-blue-500/20">
                                            <Label htmlFor={`livechat-${idx}`} className="flex flex-col space-y-1 cursor-pointer">
                                                <span className="font-medium flex items-center gap-1.5"><Headphones className="h-3.5 w-3.5" /> Live Chat</span>
                                                <span className="font-normal text-[10px] text-muted-foreground">When triggered, bot pauses for this chat and a human can respond. Resumes after timeout or {botConfig.prefix}endchat.</span>
                                            </Label>
                                            <Switch id={`livechat-${idx}`} checked={cc.isLiveChat || false}
                                                onCheckedChange={(c) => {
                                                    const updated = [...botConfig.customCommands];
                                                    updated[idx] = { ...updated[idx], isLiveChat: c };
                                                    setBotConfig(prev => ({ ...prev, customCommands: updated }));
                                                }} />
                                        </div>

                                        <div className="flex items-center justify-between space-x-2 border p-3 rounded-lg bg-purple-500/5 border-purple-500/20">
                                            <Label htmlFor={`universal-${idx}`} className="flex flex-col space-y-1 cursor-pointer">
                                                <span className="font-medium flex items-center gap-1.5">🌐 Available in All Menus</span>
                                                <span className="font-normal text-[10px] text-muted-foreground">When enabled, this command works in every menu level (main + all sub-menus).</span>
                                            </Label>
                                            <Switch id={`universal-${idx}`} checked={cc.isUniversal || false}
                                                onCheckedChange={(c) => {
                                                    const updated = [...botConfig.customCommands];
                                                    updated[idx] = { ...updated[idx], isUniversal: c };
                                                    setBotConfig(prev => ({ ...prev, customCommands: updated }));
                                                }} />
                                        </div>

                                        {!cc.isLiveChat && (
                                            <>
                                                {(cc.subCommands || []).length > 0 && renderSubCommands([idx], cc.subCommands || [], 1)}
                                                <Button type="button" variant="outline" size="sm" className="w-full border-dashed text-xs h-7"
                                                    disabled={!cc.command.trim()}
                                                    onClick={() => addSubCommandAtPath([idx])}>
                                                    <Plus className="h-3 w-3 mr-1" /> {(cc.subCommands || []).length > 0 ? 'Add Another Sub-Command' : 'Add Sub-Commands (Nested Menu)'}
                                                </Button>
                                            </>
                                        )}

                                        <p className="text-[10px] text-muted-foreground">Users can type <strong>{botConfig.prefix}{cc.command || '...'}</strong> or reply <strong>{cc.command || '...'}</strong> after viewing the menu.</p>
                                    </div>
                                </details>
                            ))}

                            <Button
                                type="button"
                                variant="outline"
                                className="w-full border-dashed"
                                onClick={() => setBotConfig(prev => ({
                                    ...prev,
                                    customCommands: [...prev.customCommands, { command: '', response: '', description: '', isLiveChat: false, isUniversal: false, subCommands: [] }]
                                }))}
                            >
                                <Plus className="h-4 w-4 mr-2" />
                                Add Custom Command
                            </Button>

                            <div className="grid gap-2 border-t border-border/50 pt-4">
                                <Label className="font-semibold flex items-center gap-1.5"><Headphones className="h-4 w-4" /> Live Chat Timeout</Label>
                                <div className="flex items-center gap-2">
                                    <Input
                                        type="number"
                                        className="max-w-[120px]"
                                        min={1}
                                        max={1440}
                                        value={botConfig.liveChatTimeout}
                                        onChange={(e) => setBotConfig(prev => ({ ...prev, liveChatTimeout: Math.max(1, parseInt(e.target.value) || 30) }))}
                                    />
                                    <span className="text-sm text-muted-foreground">minutes</span>
                                </div>
                                <p className="text-[10px] text-muted-foreground">How long the bot stays paused after a live chat command is triggered. Use <code className="bg-muted px-1 rounded">{botConfig.prefix}endchat</code> to resume early.</p>
                            </div>

                            {botConfig.customCommands.length > 0 && (
                                <p className="text-xs text-muted-foreground border-l-2 border-emerald-500/50 pl-3 py-1 bg-emerald-500/5 rounded">
                                    ℹ️ Built-in commands always take priority.{botConfig.prefix === "" ? " After menu, users can reply with just the command name." : ""}
                                </p>
                            )}

                            {/* Universal Navigation Commands */}
                            <div className="grid gap-3 border-t border-border/50 pt-4">
                                <Label className="font-semibold flex items-center gap-1.5">🌐 Universal Navigation Commands</Label>
                                <p className="text-[10px] text-muted-foreground -mt-2">These commands work globally in any menu context. Actions: <code className="bg-muted px-1 rounded">BACK</code> (up one level), <code className="bg-muted px-1 rounded">MAIN_MENU</code> (root menu), <code className="bg-muted px-1 rounded">END_CHAT</code> (end live chat), <code className="bg-muted px-1 rounded">LIVE_CHAT</code> (pause bot, human takes over).</p>
                                {botConfig.universalCommands.map((uc, uIdx) => (
                                    <div key={uIdx} className="grid grid-cols-[1fr_1fr_2fr_auto] gap-2 items-start">
                                        <Input placeholder="command" className="text-xs h-8" value={uc.command}
                                            onChange={(e) => {
                                                const cmds = [...botConfig.universalCommands];
                                                cmds[uIdx] = { ...cmds[uIdx], command: e.target.value.replace(/\s/g, '') };
                                                setBotConfig(p => ({ ...p, universalCommands: cmds }));
                                            }} />
                                        <select className="h-8 text-xs rounded-md border bg-background px-2" value={uc.action}
                                            onChange={(e) => {
                                                const cmds = [...botConfig.universalCommands];
                                                cmds[uIdx] = { ...cmds[uIdx], action: e.target.value };
                                                setBotConfig(p => ({ ...p, universalCommands: cmds }));
                                            }}>
                                            <option value="BACK">BACK</option>
                                            <option value="MAIN_MENU">MAIN_MENU</option>
                                            <option value="END_CHAT">END_CHAT</option>
                                            <option value="LIVE_CHAT">LIVE_CHAT</option>
                                        </select>
                                        <Input placeholder="description" className="text-xs h-8" value={uc.description}
                                            onChange={(e) => {
                                                const cmds = [...botConfig.universalCommands];
                                                cmds[uIdx] = { ...cmds[uIdx], description: e.target.value };
                                                setBotConfig(p => ({ ...p, universalCommands: cmds }));
                                            }} />
                                        <button type="button" className="text-muted-foreground hover:text-destructive transition-colors h-8 px-1"
                                            onClick={() => setBotConfig(p => ({ ...p, universalCommands: p.universalCommands.filter((_, i) => i !== uIdx) }))}>
                                            <X className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                ))}
                                <Button type="button" variant="outline" size="sm" className="border-dashed text-xs h-7"
                                    onClick={() => setBotConfig(p => ({ ...p, universalCommands: [...p.universalCommands, { command: '', action: 'BACK', description: '' }] }))}>
                                    <Plus className="h-3 w-3 mr-1" /> Add Universal Command
                                </Button>
                            </div>

                            <div className="pt-2">
                                <Button className="w-full sm:w-auto" onClick={handleSaveBot} disabled={botLoading || !sessionId}>
                                    {botLoading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                    Save Custom Commands
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Privacy & Utility */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Privacy & Utility</CardTitle>
                            <CardDescription>Configure ghost mode and other features for your active session.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="flex items-center justify-between space-x-2">
                                <Label htmlFor="ghost-mode" className="flex flex-col space-y-1">
                                    <span>Ghost Mode</span>
                                    <span className="font-normal text-xs text-muted-foreground">View status and read messages without sending blue ticks.</span>
                                </Label>
                                <Switch id="ghost-mode" checked={privacyConfig.ghostMode}
                                    onCheckedChange={c => setPrivacyConfig(prev => ({ ...prev, ghostMode: c }))} />
                            </div>

                            <div className="flex items-center justify-between space-x-2">
                                <Label htmlFor="anti-delete" className="flex flex-col space-y-1">
                                    <span>Anti-Delete</span>
                                    <span className="font-normal text-xs text-muted-foreground">Keep messages even if the sender deletes them for everyone.</span>
                                </Label>
                                <Switch id="anti-delete" checked={privacyConfig.antiDelete}
                                    onCheckedChange={c => setPrivacyConfig(prev => ({ ...prev, antiDelete: c }))} />
                            </div>

                            <div className="pt-4">
                                <Button onClick={handleSavePrivacy} disabled={privacyLoading || !sessionId}>
                                    {privacyLoading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                    Save Privacy Settings
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </SessionGuard>
        );
    }

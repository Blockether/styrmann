import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  entersState,
  VoiceConnectionStatus,
  EndBehaviorType,
  type VoiceConnection,
  type AudioPlayer,
} from '@discordjs/voice';
import { Readable } from 'stream';
import { type Client, type VoiceBasedChannel, Events } from 'discord.js';
import { createLogger } from './logger';
import { mcFetch } from './bridge';
import type { DaemonStats } from './types';

const log = createLogger('discord-voice');

const SILENCE_DURATION_MS = 1500;
const MAX_AUDIO_BYTES = 5 * 1024 * 1024; // 5 MB cap per utterance
const CONNECT_TIMEOUT_MS = 15_000;

interface VoiceSession {
  connection: VoiceConnection;
  player: AudioPlayer;
  channelId: string;
  guildId: string;
}

function isVoiceEnabled(): { openaiKey: string; openaiUrl: string; elevenLabsKey: string; elevenLabsVoiceId: string } | null {
  const openaiKey = process.env.OPENAI_API_KEY;
  const elevenLabsKey = process.env.ELEVENLABS_API_KEY;
  if (!openaiKey || !elevenLabsKey) return null;
  return {
    openaiKey,
    openaiUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    elevenLabsKey,
    elevenLabsVoiceId: process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL', // default: "Sarah"
  };
}

async function transcribeAudio(audioBuffer: Buffer, credentials: { openaiKey: string; openaiUrl: string }): Promise<string | null> {
  try {
    const formData = new FormData();
    const arrayBuf = audioBuffer.buffer.slice(audioBuffer.byteOffset, audioBuffer.byteOffset + audioBuffer.byteLength) as ArrayBuffer;
    const blob = new Blob([arrayBuf], { type: 'audio/ogg' });
    formData.append('file', blob, `audio-${Date.now()}.ogg`);
    formData.append('model', 'whisper-1');
    formData.append('language', 'en');

    const base = credentials.openaiUrl.replace(/\/+$/, '');
    const res = await fetch(`${base}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${credentials.openaiKey}` },
      body: formData,
    });

    if (!res.ok) {
      log.warn(`Whisper API error: ${res.status}`);
      return null;
    }

    const data = await res.json() as { text?: string };
    return data.text || null;
  } catch (err) {
    log.error('Transcription failed:', err);
    return null;
  }
}

async function synthesizeSpeech(text: string, credentials: { elevenLabsKey: string; elevenLabsVoiceId: string }): Promise<Buffer | null> {
  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${credentials.elevenLabsVoiceId}`,
      {
        method: 'POST',
        headers: {
          'Accept': 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': credentials.elevenLabsKey,
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_monolingual_v1',
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      },
    );

    if (!res.ok) {
      log.warn(`ElevenLabs API error: ${res.status}`);
      return null;
    }

    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    log.error('Speech synthesis failed:', err);
    return null;
  }
}

async function handleSpeaking(
  session: VoiceSession,
  userId: string,
  credentials: ReturnType<typeof isVoiceEnabled> & object,
  stats: DaemonStats,
): Promise<void> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  const stream = session.connection.receiver.subscribe(userId, {
    end: { behavior: EndBehaviorType.AfterSilence, duration: SILENCE_DURATION_MS },
  });

  await new Promise<void>((resolve) => {
    stream.on('data', (chunk: Buffer) => {
      if (totalBytes + chunk.length < MAX_AUDIO_BYTES) {
        chunks.push(chunk);
        totalBytes += chunk.length;
      }
    });
    stream.on('end', resolve);
    stream.on('error', () => resolve());
  });

  if (chunks.length === 0) return;

  const audioBuffer = Buffer.concat(chunks);
  log.info(`Captured ${audioBuffer.length} bytes from user ${userId}`);

  const transcription = await transcribeAudio(audioBuffer, credentials);
  if (!transcription || transcription.trim().length === 0) return;

  log.info(`Transcribed: "${transcription.slice(0, 80)}"`);

  const classifyRes = await mcFetch('/api/discord/classify', {
    method: 'POST',
    body: JSON.stringify({ message: transcription, author_name: `voice-${userId}` }),
  });

  let responseText: string;

  if (classifyRes.ok) {
    const classification = await classifyRes.json() as { type: string; title?: string; question?: string };

    if (classification.type === 'task') {
      const taskRes = await mcFetch('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title: classification.title || transcription.slice(0, 200),
          description: transcription,
          workspace_id: process.env.DISCORD_WORKSPACE_ID || 'default',
          task_type: 'feature',
          priority: 'normal',
        }),
      });
      if (taskRes.ok) {
        const task = await taskRes.json() as { title: string };
        responseText = `Task created: ${task.title}`;
        stats.discordTasksCreated = (stats.discordTasksCreated || 0) + 1;
      } else {
        responseText = 'I detected a task but failed to create it.';
      }
    } else if (classification.type === 'clarification') {
      responseText = classification.question || 'Could you provide more details?';
    } else {
      const respondRes = await mcFetch('/api/discord/respond', {
        method: 'POST',
        body: JSON.stringify({ message: transcription, author_name: `voice-${userId}` }),
      });
      if (respondRes.ok) {
        const data = await respondRes.json() as { response?: string };
        responseText = data.response || 'I received your message.';
      } else {
        responseText = 'I received your message.';
      }
    }
  } else {
    responseText = 'I received your message but could not process it.';
  }

  const speechBuffer = await synthesizeSpeech(responseText, credentials);
  if (speechBuffer) {
    const resource = createAudioResource(Readable.from(speechBuffer));
    session.player.play(resource);
    stats.discordVoiceResponses = (stats.discordVoiceResponses || 0) + 1;
  }
}

export function initVoice(client: Client, stats: DaemonStats): () => void {
  const credentials = isVoiceEnabled();
  if (!credentials) {
    log.info('Voice disabled — OPENAI_API_KEY and ELEVENLABS_API_KEY both required');
    return () => {};
  }

  log.info('Voice support enabled');

  const sessions = new Map<string, VoiceSession>();
  const speakingHandlers = new Map<string, (userId: string) => void>();

  client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
    const botId = client.user?.id;
    if (!botId) return;

    if (newState.member?.id === botId) return;

    const channel = newState.channel as VoiceBasedChannel | null;
    if (!channel) return;

    const botInChannel = channel.members.has(botId);
    if (botInChannel) return;

    const memberCount = channel.members.filter(m => !m.user.bot).size;
    if (memberCount === 0) return;

    if (sessions.has(channel.guild.id)) return;

    try {
      const connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: channel.guild.id,
        adapterCreator: channel.guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false,
      });

      await entersState(connection, VoiceConnectionStatus.Ready, CONNECT_TIMEOUT_MS);

      const player = createAudioPlayer();
      connection.subscribe(player);

      const session: VoiceSession = { connection, player, channelId: channel.id, guildId: channel.guild.id };
      sessions.set(channel.guild.id, session);

      const handler = (userId: string) => {
        handleSpeaking(session, userId, credentials, stats).catch((err) => {
          log.warn(`Voice handling failed for ${userId}:`, err);
        });
      };
      speakingHandlers.set(channel.guild.id, handler);
      connection.receiver.speaking.on('start', handler);

      connection.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
          await Promise.race([
            entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
            entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
          ]);
        } catch {
          sessions.delete(channel.guild.id);
          speakingHandlers.delete(channel.guild.id);
          connection.destroy();
          log.info(`Disconnected from voice in guild ${channel.guild.id}`);
        }
      });

      log.info(`Joined voice channel ${channel.name} in guild ${channel.guild.id}`);
    } catch (err) {
      log.warn(`Failed to join voice channel ${channel.id}:`, err);
    }
  });

  return () => {
    for (const [guildId, session] of sessions) {
      session.connection.destroy();
      log.info(`Destroyed voice session for guild ${guildId}`);
    }
    sessions.clear();
    speakingHandlers.clear();
  };
}

// Conversión de audio a ogg/opus (lo que WhatsApp acepta como nota de voz).
// Chrome graba webm/opus; se remuxea/transcodifica a ogg/opus con un ffmpeg portable.
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';

// Formatos de audio que WhatsApp acepta directo (no hace falta convertir).
export const ACCEPTED_AUDIO = ['audio/aac', 'audio/mp4', 'audio/mpeg', 'audio/amr', 'audio/ogg'];

export function needsConversion(mime) {
  return !ACCEPTED_AUDIO.includes(String(mime || '').split(';')[0].trim().toLowerCase());
}

export function convertToOggOpus(inputBuffer) {
  return new Promise((resolve, reject) => {
    const args = ['-i', 'pipe:0', '-vn', '-c:a', 'libopus', '-b:a', '32k', '-ar', '48000', '-ac', '1', '-f', 'ogg', 'pipe:1'];
    const ff = spawn(ffmpegPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [];
    let err = '';
    ff.stdout.on('data', (d) => out.push(d));
    ff.stderr.on('data', (d) => { err += d.toString(); });
    ff.on('error', reject);
    ff.on('close', (code) => {
      if (code === 0 && out.length) resolve(Buffer.concat(out));
      else reject(new Error(`ffmpeg salió ${code}: ${err.slice(-300)}`));
    });
    ff.stdin.on('error', () => {}); // ignora EPIPE si ffmpeg cierra antes
    ff.stdin.write(inputBuffer);
    ff.stdin.end();
  });
}

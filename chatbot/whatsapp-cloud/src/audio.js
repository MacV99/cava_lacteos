// Conversión de audio para envío por WhatsApp Cloud.
//
// ACTIVO: convertToMp3 → llega como archivo de audio con play. Confiable en el número
// de PRUEBA actual.
//
// GUARDADO para producción: convertToOggOpus → nota de voz nativa (onda/mic). Requiere
// enviar con `"voice": true` (ver whatsapp.js) Y un número de PRODUCCIÓN con negocio
// verificado. En el número de prueba Meta lo rechaza con 131053 ("octet-stream on
// processing") pese a que el ogg/opus es válido. Reactivar cuando se pase a producción.
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';

function runFfmpeg(args, inputBuffer) {
  return new Promise((resolve, reject) => {
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

export function convertToMp3(inputBuffer) {
  return runFfmpeg(['-i', 'pipe:0', '-vn', '-c:a', 'libmp3lame', '-b:a', '64k', '-ar', '44100', '-ac', '1', '-f', 'mp3', 'pipe:1'], inputBuffer);
}

// Nota de voz nativa (producción). mono, opus, perfil voip.
export function convertToOggOpus(inputBuffer) {
  return runFfmpeg(['-i', 'pipe:0', '-vn', '-c:a', 'libopus', '-b:a', '32k', '-ar', '48000', '-ac', '1', '-application', 'voip', '-f', 'ogg', 'pipe:1'], inputBuffer);
}

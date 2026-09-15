import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const sampleRate = 44_100;
const outputDirectory = join("public", "events", "audio");

function seededNoise(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0xffff_ffff * 2 - 1;
  };
}

function envelope(time, duration, attack = 0.015, release = 0.12) {
  return Math.min(1, time / attack, (duration - time) / release);
}

function softClip(value) {
  return Math.tanh(value * 1.35) * 0.78;
}

function render(duration, generator) {
  const length = Math.floor(duration * sampleRate);
  const samples = new Int16Array(length);
  for (let index = 0; index < length; index += 1) {
    const time = index / sampleRate;
    const value = Math.max(-1, Math.min(1, generator(time, duration, index)));
    samples[index] = Math.round(value * 32_767);
  }
  return samples;
}

function wav(samples) {
  const dataSize = samples.byteLength;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  Buffer.from(samples.buffer).copy(buffer, 44);
  return buffer;
}

const screamers = [
  [2.05, (t, d) => {
    const f = 88 + 680 * (t / d) ** 0.42;
    return softClip((Math.sin(2 * Math.PI * f * t) + 0.45 * Math.sin(2 * Math.PI * f * 1.97 * t)) * envelope(t, d) * 1.35);
  }],
  [1.85, (() => {
    const noise = seededNoise(12);
    return (t, d) => softClip((noise() * 0.62 + Math.sin(2 * Math.PI * (170 - 70 * t / d) * t)) * envelope(t, d, 0.005, 0.2) * 1.25);
  })()],
  [2.2, (t, d) => {
    const pulse = Math.sin(2 * Math.PI * 9 * t) > -0.2 ? 1 : 0.18;
    const carrier = Math.sin(2 * Math.PI * (310 + 90 * Math.sin(t * 21)) * t);
    return softClip(carrier * pulse * envelope(t, d) * 1.45);
  }],
  [1.95, (() => {
    const noise = seededNoise(731);
    return (t, d) => {
      const rise = 70 + 1_150 * (t / d) ** 2;
      return softClip((Math.sin(2 * Math.PI * rise * t) * 0.8 + noise() * 0.28) * envelope(t, d, 0.008, 0.16) * 1.4);
    };
  })()],
  [2.1, (t, d) => {
    const base = 120 + 34 * Math.sin(t * 13);
    const cluster = [1, 1.41, 2.13].reduce((sum, ratio) => sum + Math.sin(2 * Math.PI * base * ratio * t), 0) / 3;
    return softClip(cluster * envelope(t, d, 0.01, 0.28) * 1.8);
  }],
];

const sounds = [
  [0.9, (t, d) => {
    const chord = Math.sin(2 * Math.PI * 440 * t) + Math.sin(2 * Math.PI * 554.37 * t) + Math.sin(2 * Math.PI * 659.25 * t);
    return softClip(chord / 2.4 * envelope(t, d, 0.01, 0.24));
  }],
  [1.15, (t, d) => {
    const frequency = 520 * Math.exp(-2.1 * t) + 75;
    return Math.sin(2 * Math.PI * frequency * t) * envelope(t, d, 0.008, 0.24) * 0.72;
  }],
  [0.82, (t, d) => {
    const note = t < 0.2 ? 660 : t < 0.4 ? 880 : 1_100;
    return Math.sin(2 * Math.PI * note * t) * envelope(t % 0.2, 0.2, 0.006, 0.08) * envelope(t, d, 0.006, 0.12) * 0.7;
  }],
  [0.72, (() => {
    const noise = seededNoise(404);
    return (t, d) => {
      const scratch = noise() * Math.sin(2 * Math.PI * (36 + 22 * Math.sin(t * 55)) * t);
      return softClip(scratch * envelope(t, d, 0.004, 0.1) * 1.2);
    };
  })()],
  [1.3, (t, d) => {
    const frequency = 720 * (1 - t / d) ** 2 + 45;
    const wobble = 1 + 0.15 * Math.sin(2 * Math.PI * 7 * t);
    return softClip(Math.sin(2 * Math.PI * frequency * t) * wobble * envelope(t, d, 0.01, 0.3));
  }],
];

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  ...screamers.map(([duration, generator], index) =>
    writeFile(
      join(outputDirectory, `screamer-${index + 1}.wav`),
      wav(render(duration, generator)),
    ),
  ),
  ...sounds.map(([duration, generator], index) =>
    writeFile(
      join(outputDirectory, `sound-${index + 1}.wav`),
      wav(render(duration, generator)),
    ),
  ),
]);

console.log("Built 10 original Castaryn event audio assets.");

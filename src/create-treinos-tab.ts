#!/usr/bin/env bun
// One-time script to create "Treinos" tab and seed with sample data
// Run locally on Mac Mini (has the SA key file)

import { google } from 'googleapis';

const SPREADSHEET_ID = '1bxZ0O4OAWH27aBiwUzEYfamG5qG1EkF_wWoLUNqtFig';
const SA_KEY_PATH = process.env.GOOGLE_SA_KEY || '/Users/lolaclawdbot/.config/google-sheets/service-account.json';

async function main() {
  const auth = new google.auth.GoogleAuth({
    keyFile: SA_KEY_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  // Check if tab exists
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: 'sheets.properties.title',
  });
  const existing = meta.data.sheets?.map((s: any) => s.properties.title) || [];
  console.log('Existing tabs:', existing);

  if (!existing.includes('Treinos')) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{
          addSheet: { properties: { title: 'Treinos' } },
        }],
      },
    });
    console.log('Created "Treinos" tab');
  } else {
    console.log('"Treinos" tab already exists');
  }

  // grupoId for Bruno — need to look it up
  // For now, let's read Pacientes tab to find Bruno's grupoId
  const pacientes = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Pacientes',
  });
  const pRows = pacientes.data.values || [];
  console.log('Pacientes headers:', pRows[0]);
  const brunoRow = pRows.find((r: any) => r.some((c: string) => c && c.toLowerCase().includes('bruno')));
  console.log('Bruno row:', brunoRow);

  const grupoId = brunoRow?.[0] || 'bruno-001'; // fallback
  console.log('Using grupoId:', grupoId);

  // Headers + sample data
  const headers = ['grupoId', 'data', 'tipo', 'duracao_min', 'fc_media', 'fc_max', 'kcal', 'gordura_g', 'zona_dominante', 'intensidade', 'device_kcal', 'fonte', 'semana', 'aderente', 'notas'];

  // Workout 1 (2026-03-14): musculacao + bike
  const w1_seg1 = [grupoId, '2026-03-14', 'musculacao', '57', '105', '154', '204', '12', 'Z1 (Recuperação)', 'Moderado', '819', 'manual', '', '', ''];
  const w1_seg2 = [grupoId, '2026-03-14', 'bike', '30', '118', '', '195', '6', 'Z2 (FATmax)', 'Moderado', '', 'manual', '', '', ''];

  // Workout 2 (2026-03-15): bike + abdominais + alongamento
  const w2_seg1 = [grupoId, '2026-03-15', 'bike', '50', '110', '130', '325', '10.6', 'Z2 (FATmax)', 'Moderado', '517', 'manual', '', '', ''];
  const w2_seg2 = [grupoId, '2026-03-15', 'abdominais', '10', '100', '', '30', '2', 'Z1 (Recuperação)', 'Leve', '', 'manual', '', '', ''];
  const w2_seg3 = [grupoId, '2026-03-15', 'alongamento', '5', '85', '', '15', '1', 'Z1 (Recuperação)', 'Leve', '', 'manual', '', '', ''];

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Treinos!A1',
    valueInputOption: 'RAW',
    requestBody: {
      values: [headers, w1_seg1, w1_seg2, w2_seg1, w2_seg2, w2_seg3],
    },
  });

  console.log('✅ Treinos tab populated with headers and 5 sample rows (2 workouts)');
}

main().catch(console.error);

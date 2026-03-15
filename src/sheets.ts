// Google Sheets helper for Hawthorne CPET spreadsheet
import { google } from 'googleapis';

const SPREADSHEET_ID = '1bxZ0O4OAWH27aBiwUzEYfamG5qG1EkF_wWoLUNqtFig';

// Auth: tries GOOGLE_SA_KEY_JSON env var (full JSON content) first,
// then falls back to file path (GOOGLE_SA_KEY or default)
async function getAuth() {
  // Try 1: full JSON in env var
  const keyJson = process.env.GOOGLE_SA_KEY_JSON;
  if (keyJson) {
    const credentials = JSON.parse(keyJson);
    return new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  }

  // Try 2: base64-encoded JSON in env var (safer for Docker/EasyPanel)
  const keyB64 = process.env.GOOGLE_SA_KEY_B64;
  if (keyB64) {
    const decoded = Buffer.from(keyB64, 'base64').toString('utf-8');
    const credentials = JSON.parse(decoded);
    return new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  }
  
  // Try 3: file path
  const keyFile = process.env.GOOGLE_SA_KEY || '/app/service-account.json';
  return new google.auth.GoogleAuth({ keyFile, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
}

let _sheets: any = null;
async function getSheetsClient() {
  if (!_sheets) {
    const auth = await getAuth();
    _sheets = google.sheets({ version: 'v4', auth });
  }
  return _sheets;
}

// Ensure "Treinos" tab exists, create if not
export async function ensureTreinosTab(): Promise<void> {
  const sheets = await getSheetsClient();
  
  try {
    const res = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
      fields: 'sheets.properties.title',
    });
    
    const existing = res.data.sheets?.map((s: any) => s.properties.title) || [];
    if (existing.includes('Treinos')) return;
    
    // Create tab
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{
          addSheet: {
            properties: { title: 'Treinos' },
          },
        }],
      },
    });
    
    // Add header row
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Treinos!A1:O1',
      valueInputOption: 'RAW',
      requestBody: {
        values: [['grupoId', 'data', 'tipo', 'duracao_min', 'fc_media', 'fc_max', 'kcal', 'gordura_g', 'zona_dominante', 'intensidade', 'device_kcal', 'fonte', 'semana', 'aderente', 'notas']],
      },
    });
    
    console.log('[sheets] Created "Treinos" tab with headers');
  } catch (e: any) {
    if (e.message?.includes('already exists')) return;
    throw e;
  }
}

// Append workout rows to "Treinos" tab
export async function appendTreinosRows(rows: any[][]): Promise<number> {
  await ensureTreinosTab();
  const sheets = await getSheetsClient();
  
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Treinos!A:O',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows },
  });
  
  return res.data.updates?.updatedRows || rows.length;
}

// Read a tab's data (returns array of rows, each row is array of strings)
export async function readTab(tabName: string, range?: string): Promise<string[][]> {
  const sheets = await getSheetsClient();
  const fullRange = range ? `${tabName}!${range}` : tabName;
  
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: fullRange,
  });
  
  return res.data.values || [];
}

// Read Periodização tab and find which week a date falls into for a grupoId
export async function findWeekForDate(grupoId: string, dateStr: string): Promise<{ semana: number | null; weekStart: string | null; weekEnd: string | null }> {
  try {
    const rows = await readTab('Periodização');
    if (rows.length < 2) return { semana: null, weekStart: null, weekEnd: null };
    
    const headers = rows[0].map(h => h.toLowerCase().trim());
    const grupoIdx = headers.findIndex(h => h.includes('grupoid') || h.includes('grupo_id') || h === 'grupo');
    const semanaIdx = headers.findIndex(h => h.includes('semana'));
    const inicioIdx = headers.findIndex(h => h.includes('inicio') || h.includes('data_inicio'));
    const fimIdx = headers.findIndex(h => h.includes('fim') || h.includes('data_fim'));
    
    if (grupoIdx === -1 || semanaIdx === -1) return { semana: null, weekStart: null, weekEnd: null };
    
    const targetDate = new Date(dateStr + 'T12:00:00');
    
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row[grupoIdx] || row[grupoIdx] !== grupoId) continue;
      
      const semana = parseInt(row[semanaIdx]);
      if (isNaN(semana)) continue;
      
      // If we have start/end dates, check if targetDate falls within
      if (inicioIdx >= 0 && fimIdx >= 0 && row[inicioIdx] && row[fimIdx]) {
        const start = new Date(row[inicioIdx] + 'T00:00:00');
        const end = new Date(row[fimIdx] + 'T23:59:59');
        if (targetDate >= start && targetDate <= end) {
          return { semana, weekStart: row[inicioIdx], weekEnd: row[fimIdx] };
        }
      } else if (inicioIdx >= 0 && row[inicioIdx]) {
        // Only start date: assume 7-day weeks
        const start = new Date(row[inicioIdx] + 'T00:00:00');
        const end = new Date(start);
        end.setDate(end.getDate() + 6);
        if (targetDate >= start && targetDate <= end) {
          return { semana, weekStart: row[inicioIdx], weekEnd: end.toISOString().split('T')[0] };
        }
      }
    }
    
    // Fallback: calculate from week 1 start date
    const week1Row = rows.find((r, i) => i > 0 && r[grupoIdx] === grupoId && parseInt(r[semanaIdx]) === 1);
    if (week1Row && inicioIdx >= 0 && week1Row[inicioIdx]) {
      const week1Start = new Date(week1Row[inicioIdx] + 'T00:00:00');
      const diffDays = Math.floor((targetDate.getTime() - week1Start.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays >= 0) {
        const calculatedWeek = Math.floor(diffDays / 7) + 1;
        return { semana: calculatedWeek, weekStart: null, weekEnd: null };
      }
    }
    
    return { semana: null, weekStart: null, weekEnd: null };
  } catch (e: any) {
    console.error('[findWeekForDate] Error:', e.message);
    return { semana: null, weekStart: null, weekEnd: null };
  }
}

// Read Treinos for a grupoId within a date range
export async function readTreinos(grupoId: string, startDate?: string, endDate?: string): Promise<any[]> {
  const rows = await readTab('Treinos');
  if (rows.length < 2) return [];
  
  const headers = rows[0].map(h => h.toLowerCase().trim());
  
  return rows.slice(1)
    .filter(row => {
      if (row[0] !== grupoId) return false;
      if (startDate && row[1] < startDate) return false;
      if (endDate && row[1] > endDate) return false;
      return true;
    })
    .map(row => {
      const obj: any = {};
      headers.forEach((h, i) => { obj[h] = row[i] || ''; });
      return obj;
    });
}

// Read Sessões for a grupoId and week
export async function readSessoes(grupoId: string, semana?: number): Promise<any[]> {
  const rows = await readTab('Sessões');
  if (rows.length < 2) return [];
  
  const headers = rows[0].map(h => h.toLowerCase().trim());
  const grupoIdx = headers.findIndex(h => h.includes('grupoid') || h.includes('grupo_id') || h === 'grupo');
  const semanaIdx = headers.findIndex(h => h.includes('semana'));
  
  if (grupoIdx === -1) return [];
  
  return rows.slice(1)
    .filter(row => {
      if (row[grupoIdx] !== grupoId) return false;
      if (semana !== undefined && semanaIdx >= 0 && parseInt(row[semanaIdx]) !== semana) return false;
      return true;
    })
    .map(row => {
      const obj: any = {};
      headers.forEach((h, i) => { obj[h] = row[i] || ''; });
      return obj;
    });
}

// Read Periodização for a grupoId
export async function readPeriodizacao(grupoId: string): Promise<any[]> {
  const rows = await readTab('Periodização');
  if (rows.length < 2) return [];
  
  const headers = rows[0].map(h => h.toLowerCase().trim());
  const grupoIdx = headers.findIndex(h => h.includes('grupoid') || h.includes('grupo_id') || h === 'grupo');
  
  if (grupoIdx === -1) return [];
  
  return rows.slice(1)
    .filter(row => row[grupoIdx] === grupoId)
    .map(row => {
      const obj: any = {};
      headers.forEach((h, i) => { obj[h] = row[i] || ''; });
      return obj;
    });
}

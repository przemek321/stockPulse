import { useState } from 'react';
import { Button, CircularProgress } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';

/**
 * Przycisk pobierania raportu tygodniowego.
 * Odpytuje GET /api/health/weekly-report i pobiera JSON jako plik.
 */
export default function DbSummary() {
  const [loading, setLoading] = useState(false);

  const handleDownload = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/health/weekly-report?days=7');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      // Pobierz jako plik JSON
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const date = new Date().toISOString().split('T')[0];
      a.href = url;
      a.download = `stockpulse-report-${date}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(`Błąd pobierania raportu: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      variant="outlined"
      size="small"
      startIcon={loading ? <CircularProgress size={16} /> : <DownloadIcon />}
      onClick={handleDownload}
      disabled={loading}
      sx={{ mt: 1 }}
    >
      {loading ? 'Generuję...' : 'Raport tygodniowy (JSON)'}
    </Button>
  );
}

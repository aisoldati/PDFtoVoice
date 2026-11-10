import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerCode from 'pdfjs-dist/build/pdf.worker.min.mjs?raw';

const workerBlob = new Blob([pdfWorkerCode], { type: 'text/javascript' });
pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(workerBlob);

export interface PdfSegment {
  text: string;
  page: number;
  offset: number;
}

export interface PdfDocumentData {
  fullText: string;
  totalPages: number;
  segments: PdfSegment[];
}

export async function extractPdfData(
  file: File,
  onProgress?: (currentPage: number, totalPages: number) => void
): Promise<PdfDocumentData> {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({
    data: arrayBuffer,
    useSystemFonts: true,
    disableFontFace: true,
  });
  const pdf = await loadingTask.promise;
  const totalPages = pdf.numPages;

  const segments: PdfSegment[] = [];
  let fullText = '';
  let currentOffset = 0;

  // Process in small batches for maximum speed without blocking the main thread
  const BATCH_SIZE = 5;
  for (let startPage = 1; startPage <= totalPages; startPage += BATCH_SIZE) {
    const endPage = Math.min(totalPages, startPage + BATCH_SIZE - 1);
    const batchPromises = [];

    for (let p = startPage; p <= endPage; p++) {
      batchPromises.push(
        pdf.getPage(p).then(async (page) => {
          const textContent = await page.getTextContent();
          let rawPage = '';
          let lastY: number | null = null;

          for (const item of textContent.items as any[]) {
            if (!item.str) continue;
            const y = item.transform ? item.transform[5] : null;
            if (lastY !== null && y !== null && Math.abs(y - lastY) > 8) {
              rawPage += '\n';
            } else if (rawPage && !rawPage.endsWith(' ') && !rawPage.endsWith('\n')) {
              rawPage += ' ';
            }
            rawPage += item.str;
            if (y !== null) lastY = y;
          }

          page.cleanup();
          return { pageNum: p, rawPage };
        })
      );
    }

    const batchResults = await Promise.all(batchPromises);
    batchResults.sort((a, b) => a.pageNum - b.pageNum);

    for (const { pageNum, rawPage } of batchResults) {
      // Fix broken hyphenated words at line ends and normalize spaces
      const cleanedPage = rawPage
        .replace(/(\w)-\s*\n\s*(\w)/g, '$1$2')
        .replace(/[\r\t]+/g, ' ')
        .replace(/\n+/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();

      if (!cleanedPage) continue;

      // Split into natural sentences (~40-260 chars) for responsive seeking & TTS stability
      const rawSentences = cleanedPage.match(/[^.!?;:\n]+[.!?;:\n]*/g) || [cleanedPage];
      let buffer = '';

      for (const raw of rawSentences) {
        const s = raw.trim();
        if (!s) continue;
        if (buffer.length > 0 && buffer.length + s.length < 90) {
          buffer += ' ' + s;
        } else {
          if (buffer) {
            segments.push({ text: buffer, page: pageNum, offset: currentOffset });
            fullText += (fullText ? ' ' : '') + buffer;
            currentOffset = fullText.length + 1;
          }
          buffer = s;
        }
      }
      if (buffer) {
        segments.push({ text: buffer, page: pageNum, offset: currentOffset });
        fullText += (fullText ? ' ' : '') + buffer;
        currentOffset = fullText.length + 1;
      }
    }

    if (onProgress) {
      onProgress(endPage, totalPages);
    }
    // Yield briefly so UI remains 60fps during large PDF extraction
    await new Promise((r) => setTimeout(r, 0));
  }

  return {
    fullText: fullText.trim(),
    totalPages,
    segments,
  };
}

export async function extractTextFromPdf(file: File): Promise<string> {
  const data = await extractPdfData(file);
  return data.fullText;
}

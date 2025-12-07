import { corsHeaders } from '../_shared/cors.ts';

// Use unpdf which is designed for serverless/edge environments
import { getDocumentProxy } from 'npm:unpdf';

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { pdfUrl } = await req.json();

    if (!pdfUrl) {
      return new Response(
        JSON.stringify({ error: 'Missing pdfUrl parameter' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[extract-pdf-text] Processing PDF:', pdfUrl);

    // Fetch the PDF file
    const pdfResponse = await fetch(pdfUrl);
    if (!pdfResponse.ok) {
      throw new Error(`Failed to fetch PDF: ${pdfResponse.status}`);
    }

    const pdfBuffer = await pdfResponse.arrayBuffer();

    console.log('[extract-pdf-text] PDF downloaded, size:', pdfBuffer.byteLength);

    // Extract text per page for downstream embeddings
    const pdf = await getDocumentProxy(new Uint8Array(pdfBuffer));
    const totalPages = pdf.numPages;
    const pages: { pageNumber: number; text: string }[] = [];
    const fullTextParts: string[] = [];

    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const pageText = (textContent.items ?? [])
        .map((item: any) => ('str' in item ? item.str : ''))
        .join(' ');
      pages.push({ pageNumber, text: pageText });
      fullTextParts.push(pageText);
    }

    const text = fullTextParts.join('\n\n');

    console.log('[extract-pdf-text] Extraction complete, pages:', totalPages);

    return new Response(
      JSON.stringify({ 
        success: true, 
        text,
        pages,
        pageCount: totalPages 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[extract-pdf-text] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Failed to extract text from PDF' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

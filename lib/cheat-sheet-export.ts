import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import { buildCheatSheetHtml } from '@/lib/cheat-sheet';
import { CheatSheetContent } from '@/types';

export const exportCheatSheetPdf = async (params: {
  content: CheatSheetContent;
  lectureTitle: string;
  generatedAt?: string;
}) => {
  const html = buildCheatSheetHtml(params.content, {
    lectureTitle: params.lectureTitle,
    generatedAt: params.generatedAt,
  });
  const { uri } = await Print.printToFileAsync({
    html,
    base64: false,
    width: 595,
    height: 842,
  });

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      dialogTitle: params.content.title,
      UTI: 'com.adobe.pdf',
    });
  }

  return uri;
};


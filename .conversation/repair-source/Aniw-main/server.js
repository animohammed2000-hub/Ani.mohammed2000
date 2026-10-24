import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const apiKey = process.env.GEMINI_API_KEY || process.env.AI_STUDIO_API_KEY;
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

// مسار استقبال طلبات المساعد الذكي
app.post('/api/agent', async (req, res) => {
  try {
    const { message, allowWrite } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'الرسالة مطلوبة' });
    }

    if (!ai) {
      return res.status(500).json({ error: 'مفتاح GEMINI_API_KEY غير متاح في بيئة Replit' });
    }

    // قراءة ملف package.json لتزويد المساعد بسياق المشروع
    let projectContext = '';
    try {
      const packageJson = fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8');
      projectContext = `بيانات المشروع package.json:\n${packageJson}\n\n`;
    } catch (e) {
      projectContext = '';
    }

    const systemInstruction = `أنت مساعد ذكي لمشروع "آني". صلاحية التعديل: ${allowWrite ? 'مفعلة' : 'معطلة'}. أجب بإيجاز ودقة باللغة العربية بناءً على ملفات المشروع.`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        { role: 'user', parts: [{ text: `${systemInstruction}\n${projectContext}\nطلب المستخدم: ${message}` }] }
      ]
    });

    return res.json({ reply: response.text });
  } catch (error) {
    console.error('Agent Error:', error);
    return res.status(500).json({ error: error.message || 'حدث خطأ في معالجة الطلب' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});

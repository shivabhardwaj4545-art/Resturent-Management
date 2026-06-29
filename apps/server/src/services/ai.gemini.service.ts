import { GoogleGenerativeAI } from '@google/generative-ai';
import { logger } from '../utils/logger';
import dotenv from 'dotenv';
import path from 'path';

// Force reload .env to get the latest key updates without a full process restart
dotenv.config({ path: path.resolve(__dirname, '../../.env'), override: true });

function getGeminiClient(): GoogleGenerativeAI {
  return new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? '');
}

const MODEL_NAME = process.env.GEMINI_MODEL ?? 'gemini-1.5-flash';

// Helper to check for placeholder API key
function isApiKeyPlaceholder(): boolean {
  const apiKey = process.env.GEMINI_API_KEY;
  return !apiKey || apiKey === 'your-gemini-api-key' || apiKey.includes('your-');
}

// ── 1. Product Recommendation System ─────────────────────────

export interface RecommendationResult {
  menuItemId: string;
  name: string;
  reason: string;
}

export async function getAIRecommendations(params: {
  customerOrderHistory: Array<{ itemName: string; count: number }>;
  favoriteItems: string[];
  availableMenuItems: Array<{ id: string; name: string; category: string; price: number; isVeg: boolean }>;
}): Promise<RecommendationResult[]> {
  if (isApiKeyPlaceholder()) {
    logger.warn('Gemini API key is placeholder, using recommendation fallback.');
    return getMockRecommendations(params);
  }

  const client = getGeminiClient();
  const model = client.getGenerativeModel({ model: MODEL_NAME });

  const prompt = `You are a smart restaurant recommendation engine. Based on a customer's order history and available menu, suggest exactly 3 items.

Customer's order history (most ordered):
${params.customerOrderHistory.map((o) => `- ${o.itemName} (ordered ${o.count} times)`).join('\n')}

Customer's favorite items: ${params.favoriteItems.join(', ') || 'None saved'}

Available menu items:
${params.availableMenuItems
  .map((item) => `- ID: ${item.id} | ${item.name} | ${item.category} | ₹${item.price} | ${item.isVeg ? 'Veg' : 'Non-Veg'}`)
  .join('\n')}

Respond with ONLY a valid JSON array of exactly 3 objects, no markdown, no explanation:
[{"menuItemId": "...", "name": "...", "reason": "One short sentence why they'd love this"}]`;

  try {
    const result = await model.generateContent(prompt);
    const content = result.response.text();
    const cleaned = content.replace(/```json\n?|\n?```/g, '').trim();
    const recommendations = JSON.parse(cleaned) as RecommendationResult[];
    return recommendations.slice(0, 3);
  } catch (error) {
    logger.error('Gemini recommendation error, using fallback:', error);
    return getMockRecommendations(params);
  }
}

function getMockRecommendations(params: {
  availableMenuItems: Array<{ id: string; name: string; category: string; price: number; isVeg: boolean }>;
}): RecommendationResult[] {
  const recommendations: RecommendationResult[] = [];
  const itemsToSuggest = params.availableMenuItems.slice(0, 3);
  for (const item of itemsToSuggest) {
    recommendations.push({
      menuItemId: item.id,
      name: item.name,
      reason: `A popular and highly recommended ${item.category} choice from our kitchen!`
    });
  }
  return recommendations;
}

// ── 2. AI Chatbot ────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export async function getAIChatResponse(params: {
  restaurantName: string;
  menuContext: string;
  conversationHistory: ChatMessage[];
  userMessage: string;
}): Promise<string> {
  if (isApiKeyPlaceholder()) {
    logger.warn('Gemini API key is placeholder, using rule-based chatbot.');
    return getRuleBasedChatResponse(params);
  }

  const systemPrompt = `You are a helpful, friendly restaurant assistant for "${params.restaurantName}". 
Your job is to help customers with their dining decisions.

You have access to this restaurant's full menu:
${params.menuContext}

Guidelines:
- Answer questions about menu items, ingredients, allergens, spice levels, and combinations.
- Suggest dishes based on customer preferences, budget, or dietary requirements.
- Be warm, concise, and enthusiastic about the food.
- If asked about items not on the menu, politely say they're not available.
- If asked off-topic questions (unrelated to food/dining), politely decline and redirect.
- Keep responses under 150 words.
- Use ₹ for prices.`;

  try {
    const client = getGeminiClient();
    const model = client.getGenerativeModel({ 
      model: MODEL_NAME,
      systemInstruction: systemPrompt
    });

    const history = params.conversationHistory
      .filter(msg => msg.role !== 'system')
      .map((msg) => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }],
      }));

    const chat = model.startChat({
      history,
    });

    const result = await chat.sendMessage(params.userMessage);
    return result.response.text();
  } catch (error) {
    logger.error('Gemini chatbot error, using fallback:', error);
    return getRuleBasedChatResponse(params);
  }
}

interface ParsedMenuItem {
  name: string;
  category: string;
  price: number;
  isVeg: boolean;
  isVegan: boolean;
}

function getRuleBasedChatResponse(params: {
  restaurantName: string;
  menuContext: string;
  userMessage: string;
}): string {
  const message = params.userMessage.toLowerCase();
  
  // 1. Parse menu context
  const parsedItems: ParsedMenuItem[] = [];
  const lines = params.menuContext.split('\n');
  for (const line of lines) {
    const match = line.match(/^-\s*(.*?)\s*\|\s*(.*?)\s*\|\s*₹?\s*(\d+)\s*\|\s*([a-zA-Z-\/]+)/i);
    if (match) {
      const [, name, category, priceStr, vegStr] = match;
      parsedItems.push({
        name: name.trim(),
        category: category.trim(),
        price: parseInt(priceStr, 10),
        isVeg: vegStr.toLowerCase().includes('veg'),
        isVegan: vegStr.toLowerCase().includes('vegan'),
      });
    }
  }

  // 2. Handle common greetings
  if (/\b(hi|hello|hey|hola|greetings|good morning|good afternoon|good evening)\b/i.test(message)) {
    return `Hello! Welcome to ${params.restaurantName}. 🍽️ I can help you with menu questions, suggest dishes, or help you find something that fits your taste or budget. What would you like to know?`;
  }

  // 3. Handle budget queries
  const budgetMatch = message.match(/\b(under|less than|below|budget of|limit of)\s*₹?\s*(\d+)\b/i) || message.match(/\b₹?\s*(\d+)\s*(budget|limit)\b/i);
  if (budgetMatch) {
    const limit = parseInt(budgetMatch[2] || budgetMatch[1], 10);
    const options = parsedItems.filter(item => item.price <= limit).slice(0, 5);
    if (options.length > 0) {
      return `Here are some delicious options under ₹${limit} at ${params.restaurantName}:\n` + 
        options.map(item => `- **${item.name}** (${item.category}) - ₹${item.price} [${item.isVeg ? 'Veg' : 'Non-Veg'}]`).join('\n') + 
        `\n\nWould you like to try any of these?`;
    } else {
      const sorted = [...parsedItems].sort((a,b)=>a.price-b.price);
      return `We don't have any items under ₹${limit} on the menu. The most budget-friendly item we have is **${sorted[0]?.name}** for ₹${sorted[0]?.price}. Would you like to check it out?`;
    }
  }

  if (message.includes('budget') || message.includes('cheap') || message.includes('affordable') || message.includes('least expensive')) {
    const cheapOptions = [...parsedItems].sort((a, b) => a.price - b.price).slice(0, 3);
    if (cheapOptions.length > 0) {
      return `Here are some of our most affordable options:\n` +
        cheapOptions.map(item => `- **${item.name}** - ₹${item.price} (${item.category})`).join('\n');
    }
  }

  // 4. Handle dietary restriction queries
  const wantsVegan = message.includes('vegan');
  const wantsVeg = message.includes('veg') || message.includes('vegetarian');
  const wantsNonVeg = message.includes('non-veg') || message.includes('non veg') || message.includes('meat') || message.includes('chicken');

  if (wantsVegan) {
    const veganItems = parsedItems.filter(item => item.isVegan).slice(0, 5);
    if (veganItems.length > 0) {
      return `Here are our vegan options:\n` +
        veganItems.map(item => `- **${item.name}** - ₹${item.price}`).join('\n');
    }
    return `We do not have items explicitly marked as Vegan, but many of our vegetarian dishes can be prepared vegan. Please ask our staff when ordering!`;
  }

  if (wantsVeg) {
    const vegItems = parsedItems.filter(item => item.isVeg).slice(0, 5);
    if (vegItems.length > 0) {
      return `Here are some popular vegetarian items on our menu:\n` +
        vegItems.map(item => `- **${item.name}** (${item.category}) - ₹${item.price}`).join('\n');
    }
    return `We don't have vegetarian items on the menu at the moment.`;
  }

  if (wantsNonVeg) {
    const nonVegItems = parsedItems.filter(item => !item.isVeg).slice(0, 5);
    if (nonVegItems.length > 0) {
      return `Here are our non-vegetarian options:\n` +
        nonVegItems.map(item => `- **${item.name}** (${item.category}) - ₹${item.price}`).join('\n');
    }
  }

  // 5. Handle category queries
  for (const item of parsedItems) {
    if (message.includes(item.category.toLowerCase())) {
      const category = item.category;
      const catItems = parsedItems.filter(i => i.category.toLowerCase() === category.toLowerCase()).slice(0, 5);
      return `Here are the items in our **${category}** section:\n` +
        catItems.map(i => `- **${i.name}** - ₹${i.price} [${i.isVeg ? 'Veg' : 'Non-Veg'}]`).join('\n');
    }
  }

  // 6. Handle specific item queries
  for (const item of parsedItems) {
    if (message.includes(item.name.toLowerCase())) {
      return `Yes, we serve **${item.name}**! It belongs to the **${item.category}** category, costs ₹${item.price}, and is a ${item.isVeg ? 'vegetarian' : 'non-vegetarian'} dish. Would you like to add it to your order?`;
    }
  }

  // 7. General recommendation / suggestion queries
  if (message.includes('recommend') || message.includes('suggest') || message.includes('popular') || message.includes('best') || message.includes('special')) {
    const suggestions = parsedItems.slice(0, 3);
    if (suggestions.length > 0) {
      return `I highly recommend trying these customer favorites at ${params.restaurantName}:\n` +
        suggestions.map(item => `- **${item.name}** - ₹${item.price} (${item.category})`).join('\n') +
        `\n\nAll of them are prepared fresh daily! What would you like to try?`;
    }
  }

  // 8. Handle thank you
  if (message.includes('thank you') || message.includes('thanks')) {
    return "You're very welcome! Let me know if there's anything else you'd like to know about our menu. Enjoy your meal! 🍽️";
  }

  // 9. Off-topic/Generic fallback
  return `I'm your assistant for ${params.restaurantName}. I can recommend dishes, search our menu, or tell you prices. How can I help you with your order today?`;
}

// ── 3. Smart Coupon Suggestion ───────────────────────────────

export interface CouponSuggestionResult {
  couponCode: string | null;
  reason: string;
  savingsAmount: number;
}

export async function getSmartCouponSuggestion(params: {
  cartItems: Array<{ name: string; quantity: number; price: number }>;
  cartTotal: number;
  availableCoupons: Array<{
    code: string;
    type: 'FLAT' | 'PERCENT';
    value: number;
    minOrderAmount: number;
    maxDiscount?: number | null;
  }>;
}): Promise<CouponSuggestionResult> {
  if (isApiKeyPlaceholder()) {
    logger.warn('Gemini API key is placeholder, using coupon fallback.');
    return getDeterministicCouponSuggestion(params);
  }

  const client = getGeminiClient();
  const model = client.getGenerativeModel({ model: MODEL_NAME });

  const prompt = `You are a smart coupon advisor for a restaurant ordering app.

Cart items:
${params.cartItems.map((i) => `- ${i.name} x${i.quantity} = ₹${i.price * i.quantity}`).join('\n')}
Cart total: ₹${params.cartTotal}

Available coupons:
${params.availableCoupons
  .map(
    (c) =>
      `- Code: ${c.code} | Type: ${c.type} | Value: ${c.type === 'FLAT' ? '₹' + c.value : c.value + '%'} off | Min order: ₹${c.minOrderAmount}${c.maxDiscount ? ' | Max discount: ₹' + c.maxDiscount : ''}`
  )
  .join('\n')}

Find the single best coupon that gives the maximum savings for this cart. Only suggest a coupon if the cart meets the minimum order requirement.

Respond with ONLY valid JSON, no markdown:
{"couponCode": "BESTCODE", "reason": "One sentence explanation", "savingsAmount": 50}

If no coupon is applicable, respond:
{"couponCode": null, "reason": "Add more items to unlock coupons!", "savingsAmount": 0}`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text().replace(/```json\n?|\n?```/g, '').trim();
    return JSON.parse(text) as CouponSuggestionResult;
  } catch (error) {
    logger.error('Gemini coupon suggestion error, using fallback:', error);
    return getDeterministicCouponSuggestion(params);
  }
}

function getDeterministicCouponSuggestion(params: {
  cartTotal: number;
  availableCoupons: Array<{
    code: string;
    type: 'FLAT' | 'PERCENT';
    value: number;
    minOrderAmount: number;
    maxDiscount?: number | null;
  }>;
}): CouponSuggestionResult {
  let bestCoupon: any = null;
  let maxSavings = 0;

  for (const coupon of params.availableCoupons) {
    if (params.cartTotal >= coupon.minOrderAmount) {
      let savings = 0;
      if (coupon.type === 'FLAT') {
        savings = coupon.value;
      } else if (coupon.type === 'PERCENT') {
        savings = params.cartTotal * (coupon.value / 100);
        if (coupon.maxDiscount !== undefined && coupon.maxDiscount !== null) {
          savings = Math.min(savings, coupon.maxDiscount);
        }
      }
      if (savings > maxSavings) {
        maxSavings = savings;
        bestCoupon = coupon;
      }
    }
  }

  if (bestCoupon) {
    return {
      couponCode: bestCoupon.code,
      reason: `Apply code ${bestCoupon.code} to save ₹${maxSavings.toFixed(0)} on your order!`,
      savingsAmount: Math.round(maxSavings),
    };
  } else {
    return {
      couponCode: null,
      reason: 'Add more items to unlock coupons!',
      savingsAmount: 0,
    };
  }
}

// ── 4. AI Demand Forecasting ─────────────────────────────────

export interface ForecastResult {
  demandNextWeek: Array<{ date: string; predictedOrders: number }>;
  peakHours: Array<{ hour: number; label: string; avgOrders: number }>;
  topProfitableItems: Array<{ name: string; revenue: number; orders: number }>;
  monthlyForecast: number;
  alerts: string[];
}

export async function getAIDemandForecast(params: {
  restaurantName: string;
  last30DaysOrders: Array<{
    date: string;
    totalOrders: number;
    totalRevenue: number;
    peakHour: number;
  }>;
  topItemsThisMonth: Array<{ name: string; totalQuantity: number; totalRevenue: number }>;
  currentMonthRevenue: number;
}): Promise<ForecastResult> {
  const today = new Date();
  const next7Days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + i + 1);
    return d.toISOString().split('T')[0];
  });

  if (isApiKeyPlaceholder()) {
    logger.warn('Gemini API key is placeholder, using demand forecast fallback.');
    return getMockDemandForecast(params, next7Days);
  }

  const client = getGeminiClient();
  const model = client.getGenerativeModel({ model: MODEL_NAME });

  const prompt = `You are a restaurant business analyst AI for "${params.restaurantName}".

Last 30 days order data (date, orders, revenue, peak hour):
${params.last30DaysOrders
  .map((d) => `${d.date}: ${d.totalOrders} orders, ₹${d.totalRevenue} revenue, peak at ${d.peakHour}:00`)
  .join('\n')}

Top items this month:
${params.topItemsThisMonth
  .map((i) => `- ${i.name}: ${i.totalQuantity} units, ₹${i.totalRevenue} revenue`)
  .join('\n')}

Current month revenue so far: ₹${params.currentMonthRevenue}

Generate a business intelligence report. Respond with ONLY valid JSON, no markdown:
{
  "demandNextWeek": [
    {"date": "${next7Days[0]}", "predictedOrders": 45},
    ...for all 7 days
  ],
  "peakHours": [
    {"hour": 13, "label": "1 PM", "avgOrders": 25},
    ...top 6 peak hours
  ],
  "topProfitableItems": [
    {"name": "Item Name", "revenue": 15000, "orders": 120},
    ...top 5
  ],
  "monthlyForecast": 250000,
  "alerts": ["Alert message 1", "Alert message 2", ...]
}`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text().replace(/```json\n?|\n?```/g, '').trim();
    return JSON.parse(text) as ForecastResult;
  } catch (error) {
    logger.error('Gemini forecast error, using fallback:', error);
    return getMockDemandForecast(params, next7Days);
  }
}

function getMockDemandForecast(
  params: {
    topItemsThisMonth: Array<{ name: string; totalQuantity: number; totalRevenue: number }>;
    currentMonthRevenue: number;
  },
  next7Days: string[]
): ForecastResult {
  return {
    demandNextWeek: next7Days.map((date) => ({
      date,
      predictedOrders: Math.floor(Math.random() * 40 + 20),
    })),
    peakHours: [
      { hour: 12, label: '12 PM', avgOrders: 30 },
      { hour: 13, label: '1 PM', avgOrders: 35 },
      { hour: 19, label: '7 PM', avgOrders: 40 },
      { hour: 20, label: '8 PM', avgOrders: 38 },
      { hour: 21, label: '9 PM', avgOrders: 25 },
      { hour: 14, label: '2 PM', avgOrders: 20 },
    ],
    topProfitableItems: params.topItemsThisMonth.slice(0, 5).map((i) => ({
      name: i.name,
      revenue: i.totalRevenue,
      orders: i.totalQuantity,
    })),
    monthlyForecast: params.currentMonthRevenue * 1.1,
    alerts: ['AI forecast temporarily unavailable. Showing estimated data.'],
  };
}

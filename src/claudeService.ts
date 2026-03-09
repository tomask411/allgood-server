// claudeService.ts
// Replaces geminiService.ts - uses Anthropic Claude API for smart alert messages

/// <reference types="vite/client" />

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

export type Language = 'en' | 'he' | 'es' | 'ru' | 'ar';

export interface AlertMessageParams {
  userName: string;
  groupName: string;
  groupType: 'family' | 'work' | 'friends';
  area: string;
  language: Language;
  isLeader: boolean;
}

export interface GroupSummaryParams {
  leaderName: string;
  groupName: string;
  members: { name: string; status: 'safe' | 'danger' | 'unknown' | 'pending' | 'not-in-area' }[];
  language: Language;
}

// Generate a personalized alert message for a user when a siren starts
export async function generateAlertMessage(params: AlertMessageParams): Promise<string> {
  const { userName, groupName, groupType, area, language, isLeader } = params;

  const languageNames: Record<Language, string> = {
    en: 'English',
    he: 'Hebrew',
    es: 'Spanish',
    ru: 'Russian',
    ar: 'Arabic',
  };

  const groupEmoji = { family: '🏠', work: '💼', friends: '👥' }[groupType];

  const prompt = `You are AllGood, a safety app used during emergency alerts in Israel.
An alert/siren has just been triggered in the area: "${area}".

Generate a SHORT, calm, and reassuring push notification message for:
- User name: ${userName}
- Their circle: ${groupEmoji} ${groupName}
- Role: ${isLeader ? 'Circle Leader' : 'Member'}
- Language: ${languageNames[language]}

Rules:
- Write ONLY in ${languageNames[language]}
- Maximum 2 sentences
- Calm and reassuring tone, not panic-inducing
- Ask them to confirm their status (safe/not safe)
- If leader: also remind them to check on their circle members
- Do NOT include emojis in the text itself
- Return ONLY the message text, nothing else`;

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': import.meta.env.VITE_ANTHROPIC_API_KEY || '',
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-latest', // Fast & cheap for notifications
        max_tokens: 150,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await response.json();

    if (data.content && data.content[0]?.text) {
      return data.content[0].text.trim();
    }

    // Fallback messages if API fails
    return getFallbackMessage(language, userName, isLeader);
  } catch (error) {
    console.error('Claude API error:', error);
    return getFallbackMessage(language, userName, isLeader);
  }
}

// Generate a group status summary for the leader
export async function generateGroupSummary(params: GroupSummaryParams): Promise<string> {
  const { leaderName, groupName, members, language } = params;

  const languageNames: Record<Language, string> = {
    en: 'English', he: 'Hebrew', es: 'Spanish', ru: 'Russian', ar: 'Arabic',
  };

    const statusCounts = {
    safe: members.filter(m => m.status === 'safe').length,
    danger: members.filter(m => m.status === 'danger').length,
    unknown: members.filter(m => m.status === 'unknown').length,
    pending: members.filter(m => m.status === 'pending').length,
    notInArea: members.filter(m => m.status === 'not-in-area').length,
  };

  const unresponsive = members
    .filter(m => m.status === 'pending' || m.status === 'unknown')
    .map(m => m.name);

  const prompt = `You are AllGood, a safety app. Write a brief status summary for a circle leader.

Leader: ${leaderName}
Circle: ${groupName}
Members status:
- Safe: ${statusCounts.safe}
- In danger: ${statusCounts.danger}  
- Not responded: ${statusCounts.pending + statusCounts.unknown}
- Not in area: ${statusCounts.notInArea}
- Unresponsive members: ${unresponsive.join(', ') || 'none'}

Write in ${languageNames[language]}.
Be concise (2-3 sentences max).
If everyone is safe, be reassuring.
If some haven't responded, suggest following up with them.
Return ONLY the summary text.`;

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': import.meta.env.VITE_ANTHROPIC_API_KEY || '',
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-latest',
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await response.json();
    if (data.content && data.content[0]?.text) {
      return data.content[0].text.trim();
    }
    return `${statusCounts.safe} members safe, ${unresponsive.length} haven't responded yet.`;
  } catch (error) {
    console.error('Claude API error:', error);
    return `${statusCounts.safe} members safe, ${unresponsive.length} haven't responded yet.`;
  }
}

// Fallback messages when API is unavailable (offline/error)
function getFallbackMessage(language: Language, userName: string, isLeader: boolean): string {
  const messages: Record<Language, { member: string; leader: string }> = {
    en: {
      member: `${userName}, an alert has been issued in your area. Please confirm your status.`,
      leader: `${userName}, alert in your area. Please confirm your status and check on your circle members.`,
    },
    he: {
      member: `${userName}, יש אזעקה באזורך. אנא אשר את מצבך.`,
      leader: `${userName}, יש אזעקה באזורך. אנא אשר את מצבך ובדוק על חברי הקבוצה.`,
    },
    es: {
      member: `${userName}, hay una alerta en tu área. Por favor confirma tu estado.`,
      leader: `${userName}, alerta en tu área. Confirma tu estado y verifica a los miembros de tu círculo.`,
    },
    ru: {
      member: `${userName}, в вашем районе объявлена тревога. Подтвердите свой статус.`,
      leader: `${userName}, тревога в вашем районе. Подтвердите статус и проверьте участников группы.`,
    },
    ar: {
      member: `${userName}، تم إصدار تنبيه في منطقتك. يرجى تأكيد حالتك.`,
      leader: `${userName}، تنبيه في منطقتك. يرجى تأكيد حالتك والتحقق من أعضاء مجموعتك.`,
    },
  };

  return isLeader ? messages[language].leader : messages[language].member;
}

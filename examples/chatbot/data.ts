import { ActionMenu } from '@verana-labs/vs-agent-client'

export const welcomeMessage =
  'Welcome to our service. Use context menu or write help to see available actions'

export const helpMessage = [
  'Available commands:',
  '/echo <text>: repeat what you say',
  '/menu: display main menu',
  '/context: refresh context menu',
  '/link <url> [title] [desc] [icon] [openingMode]: send a link',
  '/media [url] [desc]: send an image',
  '/invitation [label] [imageUrl] [did]: send an invitation to open a new connection',
  '/profile [name] [image] [icon]: send the bot profile',
  '/call [wsUrl] [roomId]: offer a call',
  '/mrz: request the MRZ of a passport',
  '/emrtd: request the eMRTD data of a passport',
  '/proof: request a phoneNumber credential presentation',
  '/revoke <credentialExchangeId>: revoke an issued credential',
  '/rocky: get an inspiring quote from Rocky',
  '/terminate: delete the connection record on the agent, the wallet is not told',
].join('\n')

export const rootContextMenu: ActionMenu = {
  title: 'Root menu',
  description: 'These are the main available options to interact with this chatbot',
  options: [
    { name: 'home', title: '🏡 Home', description: 'Welcome message' },
    { name: 'poll', title: '⚽ World Cup poll', description: 'Vote for the winner' },
    { name: 'rocky', title: '💪 Rocky quotes', description: 'An inspiring quote' },
    { name: 'issue', title: 'Issue credential', description: 'Receive a phoneNumber credential' },
    { name: 'proof', title: 'Request proof', description: 'Present your phoneNumber credential' },
    { name: 'help', title: '🆘 Help', description: 'List the available commands' },
  ],
}

export const rootMenuAsQA = {
  prompt: 'Main menu',
  menuItems: [
    { id: 'poll', text: '⚽ World Cup poll' },
    { id: 'rocky', text: '💪 Rocky quotes' },
    { id: 'issue', text: 'Issue credential' },
    { id: 'proof', text: 'Request proof' },
    { id: 'help', text: '🆘 Help' },
  ],
}

export const worldCupPoll = {
  prompt: 'Who will win 2026 World Cup ⚽?',
  menuItems: [
    { id: 'argentina', text: '🇦🇷 Argentina' },
    { id: 'belgium', text: '🇧🇪 Belgium' },
    { id: 'brazil', text: '🇧🇷 Brazil' },
    { id: 'england', text: '🏴󠁧󠁢󠁥󠁮󠁧󠁿 England' },
    { id: 'france', text: '🇫🇷 France' },
    { id: 'germany', text: '🇩🇪 Germany' },
    { id: 'colombia', text: '🇨🇴 Colombia' },
    { id: 'other', text: '❓ Other' },
  ],
}

export const rockyQuotes = [
  'To all my love slaves out there: Thunderlips is here. In the flesh, baby. The ultimate male versus... the ultimate meatball. Ha, ha, ha.',
  "Listen, he's only a man. You can beat him because you're a tank. You're a greasy, fast, 200-pound Italian tank.",
  'Like your Popeye, he ate his spinach every day.',
  'If he dies, he dies.',
  "We always have to be in the middle of the action 'cause we're the warriors. And without some challenge, without some damn war to fight then the warriors might as well be dead, Stallion. Now I'm asking you — as a friend — stand by my side this one last time.",
  "Get up you son of a bitch! 'Cause Mickey loves you!",
  'Yo, Adrian, we did it... We did it.',
  "You are one crazy old man. ... You'll get there.",
  'Now remember, I want 500 hard ones. Go!',
  "I was wonderin' if, uh, you wouldn't mind marryin' me very much.",
  'Apollo Creed meets the Italian Stallion. Now that sounds like a damn monster movie.',
  'I want you outta here instamatically.',
  "Your nose is broken. ... How does it look? ... Ah, it's an improvement.",
  'When we fought, you had that eye of the tiger, man; the edge! And now you gotta get it back, and the way to get it back is to go back to the beginning. You know what I mean?',
  "You're wearing your anatomy out for charity. Nobody else does this much for charity.",
  "Maybe I can't win. Maybe the only thing I can do is just take everything he's got. But to beat me he's gonna have to kill me, and to kill me he's gotta have the guts to stand in front of me, and to do that he's gotta be willin' to die himself. I don't know if he's ready to do that. I don't know. I don't know.",
  'Do you like having a good time? Then you need a good watch!',
  'I feel like a Kentucky Fried Idiot!',
  "You gotta be willing to take the hits, and not pointing fingers saying you ain't where you wanna be because of him, or her, or anybody. Cowards do that and that ain't you. You're better than that!",
  "You're gonna eat lightnin' and you're gonna crap thunder!",
  "Yeah, to you it's Thanksgiving; to me it's Thursday.",
  'Every once in a while a person comes along who defies the odds, who defies logic, and fulfills an incredible dream.',
  "I just want to say hi to my girlfriend, okay? Yo, Adrian! It's me, Rocky.",
  "Why do you wanna fight? ... Because I can't sing or dance.",
  "You're gonna have to go through hell, worse than any nightmare you've ever dreamed. But when it's over, I know you'll be the one standing. You know what you have to do. Do it.",
  "The world ain't all sunshine and rainbows. It's a very mean and nasty place and I don't care how tough you are it will beat you to your knees and keep you there permanently if you let it. You, me, or nobody is gonna hit as hard as life.",
  "You and me, we don't even have a choice.",
  "I think we make a real sharp couple of coconuts - I'm dumb, you're shy, Whaddaya think, huh?",
  'Except for my kid being born, this is the greatest night in the history of my life.',
  "If you stop this fight I'll kill ya!",
  "He's not getting killed, he's getting mad!",
  "Nobody owes nobody nothin'. You owe yourself",
  "Going in one more round when you don't think you can - that's what makes all the difference in your life.",
  'Cause all I wanna do is go the distance.',
  'If I can change, and you can change, everybody can change.',
  "You ain't so bad, you ain't so bad, you ain't nothin'. C'mon, champ hit me in the face! My mother hits harder than that!",
  "I don't hate Balboa. I pity the fool!",
  'I must break you!',
  'Yo, Adrian, I did it!',
  "It ain't about how hard you hit. It's about how hard you can get hit and keep moving forward; how much you can take and keep moving forward. That's how winning is done!",
]

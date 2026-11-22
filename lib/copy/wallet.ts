// "Add to Wallet" on a member's page.
// Every fixed string this part of the app shows goes here. lib/copy.ts picks
// it up as copy.wallet; COPY.md is rebuilt from it.
export const walletCopy = {
  // On the member's page.
  title: 'Keep your code in your phone',
  body: 'A wallet pass holds your sign-in code and your first name. An outside service, WalletWallet, makes it, so those two things are sent to it. Nothing else about you is.',
  apple: 'Add to Apple Wallet',
  google: 'Add to Google Wallet',

  // Written on the pass itself. The pass never carries a last name, and nothing
  // else about the member: the rest is the same on every member's pass.
  passTeam: 'Singularity Robotics',
  passTitle: 'SINGULARITY',
  // Top right, the only words that show when passes are stacked in Wallet.
  passHeaderLabel: 'FRC',
  passHeaderValue: '10032',
  passLabel: 'MEMBER',
  // Under the name, as [label, value].
  passFront: [
    ['TEAM', 'Singularity Robotics'],
    ['SIGN IN', 'Scan at the iPad'],
  ] as [string, string][],
  // The back of the pass (the i button). iPhone makes the addresses tappable.
  passBack: [
    ['How to sign in', 'Hold this code up to the iPad at the workspace. One scan signs you in for the day.'],
    ['Your page and tasks', 'https://workspace-signin.vercel.app/login'],
    ['Team site', 'https://singularity-frc.com'],
    ['Code stopped working?', 'Ask a lead for a new QR code, then add a new pass from your page.'],
  ] as [string, string][],
  passDescription: 'Sign-in code for the team workspace',

  // Shown when a pass could not be made. Plain text, one line each.
  failed: "The pass could not be made right now. Go back and try again in a minute, or ask a lead.",
  tooMany: 'You asked for a pass too many times in a minute. Wait a minute and try again.',
  tooManyToday: 'You have asked for a pass several times today. You only need one. If it did not work, try again tomorrow or ask a lead.',
  limitReached: 'The pass service has made all the passes it can this month. Ask a lead.',

  // For a lead, on the dashboard.
  noteTitle: 'Wallet passes',
  noteOn: 'Wallet passes are on. Members see two buttons on their own page.',
  noteStandIn: 'Wallet passes are on, but they come from a built-in stand-in for testing. They are not real passes.',
  noteOff: 'Wallet passes are off, so members do not see the buttons. They turn on when the pass service key is set.',
  noteFree: 'On the free plan the pass uses one of six preset colours and the sign-in code, the first name and the team name. A custom colour, logo or picture needs a paid plan.',
  noteLimit: 'The free plan allows 1,000 passes a month. Each tap on a button makes one new pass, so each member can make five a day and no more.',
  noteSent: "When a member taps a button, their sign-in code and first name go to the pass service, WalletWallet, which makes the pass. After that the service has them. Nothing else about the member is sent.",
  noteRekey: 'A pass is never updated. If you give a member a new QR code, their old pass stops working at the kiosk and they add a new one from their page.',
} as const;

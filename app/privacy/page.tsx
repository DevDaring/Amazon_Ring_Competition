import { LegalPage } from '../components/LegalPage'

export const metadata = { title: 'Privacy policy · DoorVoice' }

const ISSUES = 'https://github.com/DevDaring/Amazon_Ring_Competition/issues'

export default function Privacy() {
  return (
    <LegalPage title="Privacy policy" updated="21 October 2026">
      <p>
        DoorVoice describes what is at your Ring door in spoken words. It was built for the Amazon Build, Ship, Shape hackathon and is a prototype. This page explains what it
        processes, where, and for how long.
      </p>

      <h2>What DoorVoice never does</h2>
      <ul>
        <li>It never identifies people: no face recognition, no biometrics, no matching faces to names.</li>
        <li>It never describes race, ethnicity, gender, religion, disability or body shape, and never judges intent.</li>
        <li>It never reads licence plates, personal names, house numbers or ID numbers aloud.</li>
        <li>It never sells data, shows ads or uses tracking cookies.</li>
      </ul>

      <h2>What it processes</h2>
      <ul>
        <li>From your Ring account (only the devices you share during account linking): device names and status, doorbell and motion notifications, event history, and camera images or short clips around an event or a question.</li>
        <li>Your voice, only while you press the talk button, to understand your question or command.</li>
        <li>What you type or set: settings, &ldquo;I&apos;m expecting&rdquo; notes, Correct / Wrong feedback, and caregiver link names.</li>
      </ul>
      <p>Privacy zones you set in the Ring app are blacked out before any image leaves the DoorVoice server.</p>

      <h2>Where it is processed</h2>
      <ul>
        <li>On the DoorVoice server, which stores events, pictures, audio and settings.</li>
        <li>
          Amazon Web Services, US East (N. Virginia): Amazon Rekognition and Amazon Bedrock describe images, Amazon Transcribe turns your voice into text, and Amazon Polly reads
          descriptions aloud.
        </li>
        <li>
          Only if an AWS service is unavailable, the same request may go to a backup provider: OpenRouter (image description), Sarvam AI (Hindi and Bengali speech) or Fish Audio
          (speech).
        </li>
      </ul>

      <h2>How long it is kept</h2>
      <ul>
        <li>Events, pictures and audio are deleted automatically after 7 days by default. You can choose 1 to 90 days in Settings.</li>
        <li>Settings &rarr; Wipe all data deletes everything at once.</li>
        <li>Feedback you give (Correct / Wrong) is kept as a small labelled example set until you wipe it, to improve DoorVoice for your camera.</li>
      </ul>

      <h2>Sharing with a caregiver</h2>
      <p>A caregiver digest is text only (counts and times, never pictures or video) and is shared only through a private link you create. You can unlink it at any time.</p>

      <h2>Your choices</h2>
      <ul>
        <li>Turn announcement types off, mute event types, or switch to visual mode in Settings.</li>
        <li>Remove DoorVoice&apos;s access to your devices in the Ring app at any time.</li>
      </ul>

      <h2>Contact</h2>
      <p>
        Questions or requests: <a href={ISSUES}>open an issue on GitHub</a>.
      </p>
    </LegalPage>
  )
}

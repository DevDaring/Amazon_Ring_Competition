import { LegalPage } from '../components/LegalPage'

export const metadata = { title: 'Terms of service · DoorVoice' }

const REPO = 'https://github.com/DevDaring/Amazon_Ring_Competition'

export default function Terms() {
  return (
    <LegalPage title="Terms of service" updated="21 October 2026">
      <p>By using DoorVoice you agree to these terms. DoorVoice is a prototype built for the Amazon Build, Ship, Shape hackathon.</p>

      <h2>Not a security or emergency system</h2>
      <ul>
        <li>DoorVoice describes scenes using automated models, and descriptions can be wrong or late.</li>
        <li>Do not rely on it for your safety, for emergencies, or to decide whether to open your door. In an emergency, contact your local emergency services.</li>
      </ul>

      <h2>Acceptable use</h2>
      <ul>
        <li>Use DoorVoice only with Ring devices you own or are allowed to use, and follow local laws on video and audio recording.</li>
        <li>Do not use it to identify, track or watch other people. DoorVoice is designed never to identify anyone.</li>
      </ul>

      <h2>Ring and other services</h2>
      <p>
        DoorVoice needs a Ring account and works only with the devices you share with it. Ring&apos;s own terms continue to apply. Images and voice are processed by Amazon Web Services and,
        only as a backup, by other providers, as described in the <a href="/privacy">privacy policy</a>.
      </p>

      <h2>Software and liability</h2>
      <ul>
        <li>
          The DoorVoice source code is open source under the MIT licence: <a href={REPO}>{REPO.replace('https://', '')}</a>.
        </li>
        <li>DoorVoice is provided &ldquo;as is&rdquo;, without warranties of any kind. To the extent the law allows, the developer is not liable for any loss arising from its use.</li>
      </ul>

      <h2>Changes and contact</h2>
      <p>
        These terms may change as the prototype develops; the date above shows the latest version. Questions: <a href={`${REPO}/issues`}>open an issue on GitHub</a>.
      </p>
    </LegalPage>
  )
}

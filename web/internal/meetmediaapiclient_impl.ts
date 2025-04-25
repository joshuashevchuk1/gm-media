// @ts-ignore

/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// At the very top of your MeetMediaApiClientImpl.ts file

// At the top of your MeetMediaApiClientImpl.ts file

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }

  // Declaring SpeechRecognitionEvent and related types to prevent TS errors
  interface SpeechRecognitionEvent extends Event {
    results: SpeechRecognitionResultList;
    resultIndex: number;
    interpretation?: string;  // Optional, depending on the browser support
    emma?: string;  // Optional, depending on the browser support
  }

  interface SpeechRecognitionResultList {
    // @ts-ignore
    length: number;
    item(index: number): SpeechRecognitionResult;
    [index: number]: SpeechRecognitionResult;
  }

  interface SpeechRecognitionResult {
    // @ts-ignore
    isFinal: boolean;
    // @ts-ignore
    length: number;
    item(index: number): SpeechRecognitionAlternative;
    [index: number]: SpeechRecognitionAlternative;
  }

  interface SpeechRecognitionAlternative {
    // @ts-ignore
    transcript: string;
    // @ts-ignore
    confidence: number;
  }
}

export {}; // Make sure to export to treat it as a module


import {
  MediaApiCommunicationProtocol,
  MediaApiCommunicationResponse,
} from '../types/communication_protocol';
import {MediaApiResponseStatus} from '../types/datachannels';
import {MeetSessionStatus} from '../types/enums';
import {
  CanvasDimensions,
  MediaEntry,
  MediaLayout,
  MediaLayoutRequest,
  MeetMediaClientRequiredConfiguration,
  MeetStreamTrack,
  Participant,
} from '../types/mediatypes';
import {MeetMediaApiClient} from '../types/meetmediaapiclient';
import {Subscribable} from '../types/subscribable';
import {ChannelLogger} from './channel_handlers/channel_logger';
import {MediaEntriesChannelHandler} from './channel_handlers/media_entries_channel_handler';
import {MediaStatsChannelHandler} from './channel_handlers/media_stats_channel_handler';
import {ParticipantsChannelHandler} from './channel_handlers/participants_channel_handler';
import {SessionControlChannelHandler} from './channel_handlers/session_control_channel_handler';
import {VideoAssignmentChannelHandler} from './channel_handlers/video_assignment_channel_handler';
import {DefaultCommunicationProtocolImpl} from './communication_protocols/default_communication_protocol_impl';
import {InternalMeetStreamTrackImpl} from './internal_meet_stream_track_impl';
import {
  InternalMediaEntry,
  InternalMediaLayout,
  InternalMeetStreamTrack,
  InternalParticipant,
} from './internal_types';
import {MeetStreamTrackImpl} from './meet_stream_track_impl';
import {SubscribableDelegate, SubscribableImpl} from './subscribable_impl';

// Meet only supports 3 audio virtual ssrcs. If disabled, there will be no
// audio.
const NUMBER_OF_AUDIO_VIRTUAL_SSRC = 3;

const MINIMUM_VIDEO_STREAMS = 0;
const MAXIMUM_VIDEO_STREAMS = 3;

/**
 * Implementation of MeetMediaApiClient.
 */
export class MeetMediaApiClientImpl implements MeetMediaApiClient {
  // Public properties
  readonly sessionStatus: Subscribable<MeetSessionStatus>;
  readonly meetStreamTracks: Subscribable<MeetStreamTrack[]>;
  readonly mediaEntries: Subscribable<MediaEntry[]>;
  readonly participants: Subscribable<Participant[]>;
  readonly presenter: Subscribable<MediaEntry | undefined>;
  readonly screenshare: Subscribable<MediaEntry | undefined>;

  // Private properties
  private readonly sessionStatusDelegate: SubscribableDelegate<MeetSessionStatus>;
  private readonly meetStreamTracksDelegate: SubscribableDelegate<
    MeetStreamTrack[]
  >;
  private readonly mediaEntriesDelegate: SubscribableDelegate<MediaEntry[]>;
  private readonly participantsDelegate: SubscribableDelegate<Participant[]>;
  private readonly presenterDelegate: SubscribableDelegate<
    MediaEntry | undefined
  >;
  private readonly screenshareDelegate: SubscribableDelegate<
    MediaEntry | undefined
  >;

  // @ts-ignore
  private _audioWebSocket?: WebSocket;
  // @ts-ignore
  private _audioProcessor?: ScriptProcessorNode;
  // @ts-ignore
  private _audioContext?: AudioContext;

  private readonly peerConnection: RTCPeerConnection;

  private sessionControlChannel: RTCDataChannel | undefined;
  private sessionControlChannelHandler:
    | SessionControlChannelHandler
    | undefined;

  private videoAssignmentChannel: RTCDataChannel | undefined;
  private videoAssignmentChannelHandler:
    | VideoAssignmentChannelHandler
    | undefined;

  private mediaEntriesChannel: RTCDataChannel | undefined;
  private mediaStatsChannel: RTCDataChannel | undefined;
  private participantsChannel: RTCDataChannel | undefined;

  /* tslint:disable:no-unused-variable */
  // This is unused because it is receive only.
  // @ts-ignore
  private mediaEntriesChannelHandler: MediaEntriesChannelHandler | undefined;

  // @ts-ignore
  private mediaStatsChannelHandler: MediaStatsChannelHandler | undefined;

  // @ts-ignore
  private participantsChannelHandler: ParticipantsChannelHandler | undefined;
  /* tslint:enable:no-unused-variable */

  private mediaLayoutId = 1;

  // Media layout retrieval by id. Needed by the video assignment channel handler
  // to update the media layout.
  private readonly idMediaLayoutMap = new Map<number, MediaLayout>();

  // Used to update media layouts.
  private readonly internalMediaLayoutMap = new Map<
    MediaLayout,
    InternalMediaLayout
  >();

  // Media entry retrieval by id. Needed by the video assignment channel handler
  // to update the media entry.
  private readonly idMediaEntryMap = new Map<number, MediaEntry>();

  // Used to update media entries.
  private readonly internalMediaEntryMap = new Map<
    MediaEntry,
    InternalMediaEntry
  >();

  // Used to update meet stream tracks.
  private readonly internalMeetStreamTrackMap = new Map<
    MeetStreamTrack,
    InternalMeetStreamTrack
  >();

  private readonly idParticipantMap = new Map<number, Participant>();
  private readonly nameParticipantMap = new Map<string, Participant>();
  private readonly internalParticipantMap = new Map<
    Participant,
    InternalParticipant
  >();

  constructor(
    private readonly requiredConfiguration: MeetMediaClientRequiredConfiguration,
  ) {
    this.validateConfiguration();

    this.sessionStatusDelegate = new SubscribableDelegate<MeetSessionStatus>(
      MeetSessionStatus.NEW,
    );
    this.sessionStatus = this.sessionStatusDelegate.getSubscribable();
    this.meetStreamTracksDelegate = new SubscribableDelegate<MeetStreamTrack[]>(
      [],
    );
    this.meetStreamTracks = this.meetStreamTracksDelegate.getSubscribable();
    this.mediaEntriesDelegate = new SubscribableDelegate<MediaEntry[]>([]);
    this.mediaEntries = this.mediaEntriesDelegate.getSubscribable();
    this.participantsDelegate = new SubscribableDelegate<Participant[]>([]);
    this.participants = this.participantsDelegate.getSubscribable();
    this.presenterDelegate = new SubscribableDelegate<MediaEntry | undefined>(
      undefined,
    );
    this.presenter = this.presenterDelegate.getSubscribable();
    this.screenshareDelegate = new SubscribableDelegate<MediaEntry | undefined>(
      undefined,
    );
    this.screenshare = this.screenshareDelegate.getSubscribable();

    const configuration = {
      sdpSemantics: 'unified-plan',
      bundlePolicy: 'max-bundle' as RTCBundlePolicy,
      iceServers: [{urls: 'stun:stun.l.google.com:19302'}],
    };

    // Create peer connection
    this.peerConnection = new RTCPeerConnection(configuration);
    this.peerConnection.ontrack = (e) => {
      if (e.track) {
        this.createMeetStreamTrack(e.track, e.receiver);
      }
    };
  }

  private validateConfiguration(): void {
    if (
      this.requiredConfiguration.numberOfVideoStreams < MINIMUM_VIDEO_STREAMS ||
      this.requiredConfiguration.numberOfVideoStreams > MAXIMUM_VIDEO_STREAMS
    ) {
      throw new Error(
        `Unsupported number of video streams, must be between ${MINIMUM_VIDEO_STREAMS} and ${MAXIMUM_VIDEO_STREAMS}`,
      );
    }
  }

  private createMeetStreamTrack(
    mediaStreamTrack: MediaStreamTrack,
    receiver: RTCRtpReceiver,
  ): void {
    const meetStreamTracks = this.meetStreamTracks.get();
    const mediaEntryDelegate = new SubscribableDelegate<MediaEntry | undefined>(
      undefined,
    );
    const meetStreamTrack = new MeetStreamTrackImpl(
      mediaStreamTrack,
      mediaEntryDelegate,
    );

    const internalMeetStreamTrack = new InternalMeetStreamTrackImpl(
      receiver,
      mediaEntryDelegate,
      meetStreamTrack,
      this.internalMediaEntryMap,
    );

    const newStreamTrackArray = [...meetStreamTracks, meetStreamTrack];
    this.internalMeetStreamTrackMap.set(
      meetStreamTrack,
      internalMeetStreamTrack,
    );
    this.meetStreamTracksDelegate.set(newStreamTrackArray);
  }

  async joinMeeting(
    communicationProtocol?: MediaApiCommunicationProtocol,
  ): Promise<void> {
    // The offer must be in the order of audio, datachannels, video.

    // Create audio transceivers based on initial config.
    if (this.requiredConfiguration.enableAudioStreams) {
      for (let i = 0; i < NUMBER_OF_AUDIO_VIRTUAL_SSRC; i++) {
        // Integrating clients must support and negotiate the OPUS codec in
        // the SDP offer.
        // This is the default for WebRTC.
        // https://developer.mozilla.org/en-US/docs/Web/Media/Formats/WebRTC_codecs.
        this.peerConnection.addTransceiver('audio', {direction: 'recvonly'});
      }
    }

    // ---- UTILITY DATA CHANNELS -----

    // All data channels must be reliable and ordered.
    const dataChannelConfig = {
      ordered: true,
      reliable: true,
    };

    // Always create the session and media stats control channel.
    this.sessionControlChannel = this.peerConnection.createDataChannel(
      'session-control',
      dataChannelConfig,
    );
    let sessionControlchannelLogger;
    if (this.requiredConfiguration?.logsCallback) {
      sessionControlchannelLogger = new ChannelLogger(
        'session-control',
        this.requiredConfiguration.logsCallback,
      );
    }
    this.sessionControlChannelHandler = new SessionControlChannelHandler(
      this.sessionControlChannel,
      this.sessionStatusDelegate,
      sessionControlchannelLogger,
    );

    this.mediaStatsChannel = this.peerConnection.createDataChannel(
      'media-stats',
      dataChannelConfig,
    );
    let mediaStatsChannelLogger;
    if (this.requiredConfiguration?.logsCallback) {
      mediaStatsChannelLogger = new ChannelLogger(
        'media-stats',
        this.requiredConfiguration.logsCallback,
      );
    }
    this.mediaStatsChannelHandler = new MediaStatsChannelHandler(
      this.mediaStatsChannel,
      this.peerConnection,
      mediaStatsChannelLogger,
    );

    // ---- CONDITIONAL DATA CHANNELS -----

    // We only need the video assignment channel if we are requesting video.
    if (this.requiredConfiguration.numberOfVideoStreams > 0) {
      this.videoAssignmentChannel = this.peerConnection.createDataChannel(
        'video-assignment',
        dataChannelConfig,
      );
      let videoAssignmentChannelLogger;
      if (this.requiredConfiguration?.logsCallback) {
        videoAssignmentChannelLogger = new ChannelLogger(
          'video-assignment',
          this.requiredConfiguration.logsCallback,
        );
      }
      this.videoAssignmentChannelHandler = new VideoAssignmentChannelHandler(
        this.videoAssignmentChannel,
        this.idMediaEntryMap,
        this.internalMediaEntryMap,
        this.idMediaLayoutMap,
        this.internalMediaLayoutMap,
        this.mediaEntriesDelegate,
        this.internalMeetStreamTrackMap,
        videoAssignmentChannelLogger,
      );
    }

    if (
      this.requiredConfiguration.numberOfVideoStreams > 0 ||
      this.requiredConfiguration.enableAudioStreams
    ) {
      this.mediaEntriesChannel = this.peerConnection.createDataChannel(
        'media-entries',
        dataChannelConfig,
      );
      let mediaEntriesChannelLogger;
      if (this.requiredConfiguration?.logsCallback) {
        mediaEntriesChannelLogger = new ChannelLogger(
          'media-entries',
          this.requiredConfiguration.logsCallback,
        );
      }
      this.mediaEntriesChannelHandler = new MediaEntriesChannelHandler(
        this.mediaEntriesChannel,
        this.mediaEntriesDelegate,
        this.idMediaEntryMap,
        this.internalMediaEntryMap,
        this.internalMeetStreamTrackMap,
        this.internalMediaLayoutMap,
        this.participantsDelegate,
        this.nameParticipantMap,
        this.idParticipantMap,
        this.internalParticipantMap,
        this.presenterDelegate,
        this.screenshareDelegate,
        mediaEntriesChannelLogger,
      );

      this.participantsChannel =
        this.peerConnection.createDataChannel('participants');
      let participantsChannelLogger;
      if (this.requiredConfiguration?.logsCallback) {
        participantsChannelLogger = new ChannelLogger(
          'participants',
          this.requiredConfiguration.logsCallback,
        );
      }

      this.participantsChannelHandler = new ParticipantsChannelHandler(
        this.participantsChannel,
        this.participantsDelegate,
        this.idParticipantMap,
        this.nameParticipantMap,
        this.internalParticipantMap,
        this.internalMediaEntryMap,
        participantsChannelLogger,
      );
    }

    this.sessionStatusDelegate.subscribe((status) => {
      if (status === MeetSessionStatus.DISCONNECTED) {
        this.mediaStatsChannel?.close();
        this.videoAssignmentChannel?.close();
        this.mediaEntriesChannel?.close();
      }
    });

    // Local description has to be set before adding video transceivers to
    // preserve the order of audio, datachannels, video.
    let pcOffer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(pcOffer);

    for (let i = 0; i < this.requiredConfiguration.numberOfVideoStreams; i++) {
      // Integrating clients must support and negotiate AV1, VP9, and VP8 codecs
      // in the SDP offer.
      // The default for WebRTC is VP8.
      // https://developer.mozilla.org/en-US/docs/Web/Media/Formats/WebRTC_codecs.
      this.peerConnection.addTransceiver('video', {direction: 'recvonly'});
    }

    pcOffer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(pcOffer);
    let response: MediaApiCommunicationResponse;
    try {
      const protocol: MediaApiCommunicationProtocol =
        communicationProtocol ??
        new DefaultCommunicationProtocolImpl(this.requiredConfiguration);
      response = await protocol.connectActiveConference(pcOffer.sdp ?? '');
    } catch (e) {
      throw new Error(
        'Internal error, call to connectActiveConference failed, Exception: ' +
          (e as Error).name +
          ' ' +
          (e as Error).message,
      );
    }
    if (response?.answer) {
      await this.peerConnection.setRemoteDescription({
        type: 'answer',
        sdp: response?.answer,
      });
    } else {
      // We do not expect this to happen and therefore it is an internal
      // error.
      throw new Error('Internal error, no answer in response');
    }
    return;
  }

  leaveMeeting(): Promise<void> {
    if (this.sessionControlChannelHandler) {
      return this.sessionControlChannelHandler?.leaveSession();
    } else {
      throw new Error('You must connect to a meeting before leaving it');
    }
  }

  // The promise resolving on the request does not mean the layout has been
  // applied. It means that the request has been accepted and you may need to
  // wait a short amount of time for these layouts to be applied.
  applyLayout(requests: MediaLayoutRequest[]): Promise<MediaApiResponseStatus> {
    if (!this.videoAssignmentChannelHandler) {
      throw new Error(
        'You must connect to a meeting with video before applying a layout',
      );
    }
    requests.forEach((request) => {
      if (!request.mediaLayout) {
        throw new Error('The request must include a media layout');
      }
      if (!this.internalMediaLayoutMap.has(request.mediaLayout)) {
        throw new Error(
          'The media layout must be created using the client before it can be applied',
        );
      }
    });
    return this.videoAssignmentChannelHandler.sendRequests(requests);
  }

  createMediaLayout(canvasDimensions: CanvasDimensions): MediaLayout {
    const mediaEntryDelegate = new SubscribableDelegate<MediaEntry | undefined>(
      undefined,
    );
    const mediaEntry = new SubscribableImpl<MediaEntry | undefined>(
      mediaEntryDelegate,
    );
    const mediaLayout: MediaLayout = {canvasDimensions, mediaEntry};
    this.internalMediaLayoutMap.set(mediaLayout, {
      id: this.mediaLayoutId,
      mediaEntry: mediaEntryDelegate,
    });
    this.idMediaLayoutMap.set(this.mediaLayoutId, mediaLayout);
    this.mediaLayoutId++;
    return mediaLayout;
  }

  public async startRecordingAndSaveAudio() {
    const audioElement = document.getElementById('audio-1') as HTMLAudioElement;

    if (audioElement && audioElement.srcObject) {
      // Explicitly assert srcObject to MediaStream type
      const mediaStream = audioElement.srcObject as MediaStream;

      // Initialize the MediaRecorder with the stream from audio-1
      const mediaRecorder = new MediaRecorder(mediaStream);
      const chunks: BlobPart[] = [];

      // When data is available, push it into chunks array
      mediaRecorder.ondataavailable = (event) => {
        chunks.push(event.data);
      };

      // When recording is stopped, save the audio to a file
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'audio-output.webm';
        a.click();
        URL.revokeObjectURL(url);
      };

      // Start recording
      mediaRecorder.start();

      // Stop recording every 30 seconds and save the audio
      setInterval(() => {
        if (mediaRecorder.state === 'recording') {
          mediaRecorder.stop();
          mediaRecorder.start();
        }
      }, 30000); // 30 seconds interval
    } else {
      console.error('Audio element or stream not found.');
    }
  }



  public async listenForVoiceCommandFromAudioElement(): Promise<void> {
    // Get the audio element (audio-1)
    const audioElement = document.getElementById('audio-1') as HTMLAudioElement;

    if (audioElement) {
      // Ensure the audio is playing before starting the voice detection
      console.log("audio element loaded");
      if (!audioElement.paused) {
        console.log('Listening for voice commands while audio is playing...');

        // Check if SpeechRecognition is available
        if ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window) {
          console.log("speechRecognition available");
          const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
          recognition.lang = 'en-US'; // Set the language for recognition
          recognition.continuous = true; // Keep recognition running
          recognition.interimResults = true; // Get interim results while speaking

          // Start listening for voice commands
          recognition.start();

          // Process results and detect specific commands
          recognition.onresult = (event: SpeechRecognitionEvent) => {
            this.processVoiceCommand(event);
          };

          recognition.onerror = (event: { error: any; }) => {
            console.error('Speech recognition error: ', event.error);
          };
        } else {
          console.warn('Speech Recognition API is not supported in this browser.');
        }
      } else {
        console.warn('Audio is not playing, cannot listen for voice commands.');
      }
    } else {
      console.warn('Element with id "audio-1" not found.');
    }
  }

  private processVoiceCommand(event: SpeechRecognitionEvent): void {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript.toLowerCase();

      // Detect specific voice commands
      if (transcript.includes('hey hackerman')) {
        console.log("got voice command");
        console.log('Voice command detected: hey hackerman');
        const response = 'Hackerman is online'
        this.injectAudioFromSpeech(response);
        this.startRealtimeAiApiSession();
      }

      if (transcript.includes('start')) {
        console.log("got voice command");
        console.log('Voice command detected: Start');
        this.triggerStartAction();
      }
    }
  }


  public async startRealtimeAiApiSession() {
    console.log('Action triggered for "Hello" command');
    // Implement your specific action here
    let emp_token = await this.getEmpToken()
    const EPHEMERAL_KEY = emp_token
    const pc = new RTCPeerConnection();

    // Reference the existing audio-1 element and cast it to HTMLAudioElement
    const audioEl = document.getElementById("audio-1") as HTMLAudioElement;
    if (!audioEl) {
      console.error("Audio element not found!");
      return;
    }

    pc.ontrack = e => {
      audioEl.srcObject = e.streams[0]; // Play the incoming stream to the audio-1 element
    };

    // Add local audio track for microphone input in the browser
    const ms = await navigator.mediaDevices.getUserMedia({
      audio: true
    });

    audioEl.srcObject = ms;
    pc.addTrack(ms.getTracks()[0]);

    // Set up data channel for sending and receiving events
    const dc = pc.createDataChannel("oai-events");
    dc.addEventListener("message", (e) => {
      // Realtime server events appear here!
      console.log(e);
    });

    // Start the session using the Session Description Protocol (SDP)
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const baseUrl = "https://api.openai.com/v1/realtime";
    const model = "gpt-4o-realtime-preview-2024-12-17";
    const sdpResponse = await fetch(`${baseUrl}?model=${model}`, {
      method: "POST",
      body: offer.sdp,
      headers: {
        Authorization: `Bearer ${EPHEMERAL_KEY}`,
        "Content-Type": "application/sdp"
      },
    });

    const answer: RTCSessionDescriptionInit = {
      type: "answer",
      sdp: await sdpResponse.text(),
    };

    await pc.setRemoteDescription(answer);
  }




  private triggerStartAction() {
    console.log('Action triggered for "Start" command');
    // Implement your specific action here
  }


  public async injectAudioOnceFromPath(relativePath: string): Promise<void> {
    console.log("Entering injectAudioOnceFromPath");

    const audioContext = new AudioContext();

    const response = await fetch(relativePath);
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;

    const destination = audioContext.createMediaStreamDestination();
    source.connect(destination);
    source.start(0);

    const [track] = destination.stream.getAudioTracks();
    this.peerConnection.addTrack(track, destination.stream);

    // 🔊 Play audio locally on <audio id="audio-1">
    const audioElement = document.getElementById('audio-1') as HTMLAudioElement;
    if (audioElement) {
      audioElement.srcObject = destination.stream;
      audioElement.autoplay = true;
      audioElement.muted = false;
      audioElement.play().catch((err) =>
          console.error("Failed to play audio-1:", err)
      );
    } else {
      console.warn("Element with id 'audio-1' not found");
    }

    console.log("Leaving injectAudioOnceFromPath");
  }

  public async injectAudioFromSpeech(text: string, language: string = 'en-US', volume: number = 1, rate: number = 1, pitch: number = 1): Promise<void> {
    console.log("Entering injectAudioFromSpeech");

    // Create a new SpeechSynthesisUtterance object for the provided text
    const utterance = new SpeechSynthesisUtterance(text);

    // Set speech parameters (language, volume, rate, pitch)
    utterance.lang = language;
    utterance.volume = volume; // 0 to 1
    utterance.rate = rate; // 0.1 to 10
    utterance.pitch = pitch; // 0 to 2

    // Create an AudioContext
    const audioContext = new AudioContext();

    // Create a MediaStreamDestination (to route the speech audio to a MediaStream)
    const destination = audioContext.createMediaStreamDestination();

    // Create an AudioNode that will play the speech
    const source = audioContext.createBufferSource();

    // Use the SpeechSynthesis API to speak the text and create a stream
    const audioStream = new MediaStream();

    // When the utterance is spoken, route the audio into the stream
    utterance.onstart = () => {
      console.log("Speech started");

      // Create a new source node from the speech synthesis output and connect it to the MediaStream
      source.connect(destination);
      source.start();
    };

    // Handle the audio being played in the 'audio-1' element
    utterance.onend = () => {
      console.log("Speech finished");

      // Add the stream from the destination to the 'audio-1' element
      const audioElement = document.getElementById('audio-1') as HTMLAudioElement;
      if (audioElement) {
        audioElement.srcObject = destination.stream;
        audioElement.autoplay = true;
        audioElement.muted = false;
        audioElement.play().catch((err) =>
            console.error("Failed to play speech audio in audio-1:", err)
        );
      } else {
        console.warn("Element with id 'audio-1' not found");
      }
    };

    // Error handling
    utterance.onerror = (event) => {
      console.error('Speech synthesis error:', event.error);
    };

    // Speak the text (this will trigger the onstart and onend events)
    window.speechSynthesis.speak(utterance);

    console.log("Leaving injectAudioFromSpeech");
  }


  public async sendAudioToWebSocket() {
    const audioElement = document.getElementById('audio-1') as HTMLAudioElement;

    if (audioElement && audioElement.srcObject) {
      // Get the MediaStream from the audio element
      const mediaStream = audioElement.srcObject as MediaStream;

      // Log the MediaStream and its audio tracks to ensure valid tracks are present
      console.log("MediaStream:", mediaStream);
      console.log("Audio Tracks:", mediaStream.getAudioTracks());

      // Now, pipe it to the WebSocket
      const webSocketUrl = 'ws://localhost:8765'; // Change this to your WebSocket URL
      const client = (window as any).client; // Ensure the client is available

      if (client) {
        try {
          console.log('Piping audio to WebSocket...');

          // Ensure that pipeRemoteAudioToWebSocket is not recursively called
          if (this._audioWebSocket) {
            console.warn("WebSocket already connected, not re-initiating.");
            return;
          }

          // Call the pipeRemoteAudioToWebSocket function to send the audio
          await client.pipeRemoteAudioToWebSocket(webSocketUrl, mediaStream);
          console.log('Audio from audio-1 successfully piped to WebSocket');
        } catch (error) {
          console.error('Failed to pipe audio:', error);
        }
      } else {
        console.error('Client not found');
      }
    } else {
      console.error('Audio element or srcObject not found');
    }
  }

  public async pipeRemoteAudioToWebSocket(webSocketUrl: string, remoteMediaStream: MediaStream) {
    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(remoteMediaStream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    const socket = new WebSocket(webSocketUrl);
    socket.binaryType = 'arraybuffer';

    processor.onaudioprocess = (event) => {
      if (socket.readyState === WebSocket.OPEN) {
        const input = event.inputBuffer.getChannelData(0);
        const floatBuffer = new Float32Array(input);
        socket.send(floatBuffer.buffer);
      }
    };

    source.connect(processor);
    processor.connect(audioContext.destination);

    this._audioWebSocket = socket;
    this._audioProcessor = processor;
    this._audioContext = audioContext;
  }

  public async getEmpToken() {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is missing');
    }

    try {
      const response = await fetch("https://api.openai.com/v1/realtime/sessions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-realtime-preview-2024-12-17",
          voice: "verse",
        }),
      });

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      const data = await response.json();
      return data; // Handle the response data as needed

    } catch (error) {
      console.error('Error during session start:', error);
      throw error; // Re-throw the error if needed for further handling
    }
  }
}


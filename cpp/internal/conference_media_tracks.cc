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

#include "cpp/internal/conference_media_tracks.h"

#include <cstddef>
#include <cstdint>
#include <utility>

#include "absl/log/log.h"
#include "absl/types/optional.h"
#include "absl/types/span.h"
#include "cpp/api/media_api_client_interface.h"
#include "webrtc/api/rtp_packet_info.h"
#include "webrtc/api/rtp_packet_infos.h"
#include "webrtc/api/transport/rtp/rtp_source.h"
#include "webrtc/api/video/video_frame.h"

namespace meet {

void ConferenceAudioTrack::OnData(
    const void* audio_data, int bits_per_sample, int sample_rate,
    size_t number_of_channels, size_t number_of_frames,
    absl::optional<int64_t> absolute_capture_timestamp_ms) {
  if (bits_per_sample != 16) {
    LOG(ERROR) << "Unsupported bits per sample: " << bits_per_sample
               << ". Expected 16.";
    return;
  }

  // Audio data is expected to be in PCM format, where each sample is 16 bits.
  const auto* pcm_data = reinterpret_cast<const int16_t*>(audio_data);

  bool is_from_loudest_speaker = false;
  std::optional<uint32_t> csrc;
  std::optional<uint32_t> ssrc;
  // Audio csrcs and ssrcs are not included in the audio data. Therefore,
  // extract them from the RtpReceiver.
  for (const auto& rtp_source : receiver_->GetSources()) {
    // It is expected that there may be 1 or 2 contributing sources. The
    // contributing source corresponding to the participant's audio stream will
    // always be present. Meet may also send a contributing source with value
    // `kLoudestSpeakerCsrc` to indicate that this audio stream is from the
    // loudest speaker.
    //
    // Knowing the loudest speaker can be useful, as it can be used to determine
    // which participant to prioritize when rendering audio or video (although
    // other methods may be used as well).
    if (rtp_source.source_type() == webrtc::RtpSourceType::CSRC) {
      if (rtp_source.source_id() == kLoudestSpeakerCsrc) {
        is_from_loudest_speaker = true;
      } else {
        csrc = rtp_source.source_id();
      }
    } else if (rtp_source.source_type() == webrtc::RtpSourceType::SSRC) {
      ssrc = rtp_source.source_id();
    }
  }

  if (!csrc.has_value() || !ssrc.has_value()) {
    // Before real audio starts flowing, silent audio frames will be received.
    // These frames will not have a CSRC or SSRC. Because these frames will be
    // received frequently, log them at a lower level to avoid cluttering the
    // logs.
    //
    // However, this may still happen in error cases, so something should be
    // logged.
    if (!csrc.has_value()) {
      VLOG(2) << "AudioFrame is missing CSRC for mid: " << mid_;
    }
    if (!ssrc.has_value()) {
      VLOG(2) << "AudioFrame is missing SSRC for mid: " << mid_;
    }
    return;
  }

  // Audio data in PCM format is expected to be stored in a contiguous buffer,
  // where there are `number_of_channels * number_of_frames` audio frames.
  absl::Span<const int16_t> pcm_data_span =
      absl::MakeConstSpan(pcm_data, number_of_channels * number_of_frames);
  callback_(AudioFrame{.pcm16 = std::move(pcm_data_span),
                       .bits_per_sample = bits_per_sample,
                       .sample_rate = sample_rate,
                       .number_of_channels = number_of_channels,
                       .number_of_frames = number_of_frames,
                       .is_from_loudest_speaker = is_from_loudest_speaker,
                       .contributing_source = csrc.value(),
                       .synchronization_source = ssrc.value()});
};

void ConferenceVideoTrack::OnFrame(const webrtc::VideoFrame& frame) {
  const webrtc::RtpPacketInfos& packet_infos = frame.packet_infos();
  if (packet_infos.empty()) {
    LOG(ERROR) << "VideoFrame is missing packet infos for mid: " << mid_;
    return;
  }
  const webrtc::RtpPacketInfo& packet_info = packet_infos.front();
  if (packet_info.csrcs().empty()) {
    LOG(ERROR) << "VideoFrame is missing CSRC for mid: " << mid_;
    return;
  }

  callback_(VideoFrame{.frame = frame,
                       // It is expected that there will be only one CSRC per
                       // video frame.
                       .contributing_source = packet_info.csrcs().front(),
                       .synchronization_source = packet_info.ssrc()});
};

}  // namespace meet

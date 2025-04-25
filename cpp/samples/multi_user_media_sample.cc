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


#include <cstdlib>
#include <memory>
#include <string>
#include <utility>

#include "absl/flags/flag.h"
#include "absl/flags/parse.h"
#include "absl/flags/usage.h"
#include "absl/log/log.h"
#include "absl/status/status.h"
#include "absl/status/statusor.h"
#include "absl/time/clock.h"
#include "absl/time/time.h"
#include "cpp/api/media_api_client_interface.h"
#include "cpp/api/video_assignment_resource.h"
#include "cpp/internal/media_api_client_factory.h"
#include "cpp/samples/multi_user_media_collector.h"
#include "webrtc/api/make_ref_counted.h"
#include "webrtc/rtc_base/thread.h"

ABSL_FLAG(std::string, output_file_prefix, "/tmp/test_output_",
          "Directory and file prefix where files will be written. Files will "
          "be written to <output_file_prefix>_<filename>.");

ABSL_FLAG(std::string, meet_api_url, "https://meet.googleapis.com/v2beta",
          "The base URL to use for the Meet API.");

ABSL_FLAG(std::string, meeting_space_id, "",
          "The meeting code or the ID of the meeting space to connect to.");

ABSL_FLAG(std::string, oauth_token, "",
          "The OAuth token to use for the Meet API.");

ABSL_FLAG(absl::Duration, collection_duration, absl::Seconds(30),
          "The duration of media collection once the app joins the "
          "conference. The app will leave the conference after this duration.");

ABSL_FLAG(absl::Duration, join_timeout, absl::Minutes(2),
          "The maximum amount of time to wait for the client to join the "
          "conference. The initiating participant must allow the client to "
          "join via the Meet UI before the app can join. Therefore, wait for "
          "a reasonable amount of time for the participant to complete this "
          "step.");

ABSL_FLAG(absl::Duration, segment_gap_threshold, absl::Seconds(1),
          "The amount of time that must pass between media frames before a new "
          "media segment is created. If 2 media frames are received with less "
          "that this gap, they will be considered part of the same segment. A "
          "larger gap will result in fewer, sparser segments. A smaller gap "
          "will result in more, denser segments.");

namespace {

meet::VideoAssignmentChannelFromClient CreateVideoAssignmentRequest() {
  // Request 3 video streams with dimensions of 100px x 100px
  // Set the assignment protocol such that the backend chooses which streams
  // are relevant to send the client.
  meet::VideoCanvas canvas1{
      .id = 1,
      .dimensions = {.height = 100, .width = 100},
      .assignment_protocol = meet::VideoCanvas::AssignmentProtocol::kRelevant,
  };
  meet::VideoCanvas canvas2{
      .id = 2,
      .dimensions = {.height = 100, .width = 100},
      .assignment_protocol = meet::VideoCanvas::AssignmentProtocol::kRelevant,
  };
  meet::VideoCanvas canvas3{
      .id = 3,
      .dimensions = {.height = 100, .width = 100},
      .assignment_protocol = meet::VideoCanvas::AssignmentProtocol::kRelevant,
  };

  meet::VideoAssignmentChannelFromClient request{
      .request = {
          .request_id = 1,
          .set_video_assignment_request = meet::SetVideoAssignmentRequest{
              .layout_model =
                  meet::LayoutModel{.label = "test_client_layout",
                                    .canvases = {canvas1, canvas2, canvas3}},
              // This is the max allowable resolution we wish to receive if the
              // 100 x 100 is not attainable.
              .video_resolution = meet::VideoResolution{
                  .height = 400,
                  .width = 400,
                  .frame_rate = 30,
              }}}};
  return request;
}

}  // namespace

int main(int argc, char** argv) {
  absl::SetProgramUsageMessage(argv[0]);
  absl::ParseCommandLine(argc, argv);
  std::string output_file_prefix = absl::GetFlag(FLAGS_output_file_prefix);
  if (output_file_prefix.empty()) {
    LOG(ERROR) << "Output directory is empty";
    return EXIT_FAILURE;
  }
  std::string meet_api_url = absl::GetFlag(FLAGS_meet_api_url);
  if (meet_api_url.empty()) {
    LOG(ERROR) << "Meet API URL is empty";
    return EXIT_FAILURE;
  }
  std::string conference_id = absl::GetFlag(FLAGS_meeting_space_id);
  if (conference_id.empty()) {
    LOG(ERROR) << "Meeting space ID is empty";
    return EXIT_FAILURE;
  }
  std::string oauth_token = absl::GetFlag(FLAGS_oauth_token);
  if (oauth_token.empty()) {
    LOG(ERROR) << "OAuth token is empty";
    return EXIT_FAILURE;
  }

  std::unique_ptr<rtc::Thread> collector_thread = rtc::Thread::Create();
  collector_thread->SetName("collector_thread", nullptr);
  if (!collector_thread->Start()) {
    LOG(ERROR) << "Failed to start collector thread";
    return EXIT_FAILURE;
  }

  auto media_collector =
      webrtc::make_ref_counted<media_api_samples::MultiUserMediaCollector>(
          output_file_prefix, absl::GetFlag(FLAGS_segment_gap_threshold),
          std::move(collector_thread));
  meet::MediaApiClientConfiguration config = {
      .receiving_video_stream_count = 3,
      .enable_audio_streams = true,
  };
  absl::StatusOr<std::unique_ptr<meet::MediaApiClientInterface>> client_status =
      meet::MediaApiClientFactory().CreateMediaApiClient(std::move(config),
                                                         media_collector);
  if (!client_status.ok()) {
    LOG(ERROR) << "Failed to create MediaApiClient: " << client_status.status();
    return EXIT_FAILURE;
  }
  std::unique_ptr<meet::MediaApiClientInterface> client =
      *std::move(client_status);
  LOG(INFO) << "Created MediaApiClient";

  if (absl::Status connect_status = client->ConnectActiveConference(
          meet_api_url, conference_id, oauth_token);
      !connect_status.ok()) {
    LOG(ERROR) << "Failed to connect to meeting space: " << connect_status;
    return EXIT_FAILURE;
  }
  LOG(INFO) << "Connected to active conference";

  if (absl::Status join_status =
          media_collector->WaitForJoined(absl::GetFlag(FLAGS_join_timeout));
      !join_status.ok()) {
    LOG(ERROR) << "Failed to join conference: " << join_status;
    return EXIT_FAILURE;
  }
  LOG(INFO) << "Joined conference";

  if (absl::Status send_status =
          client->SendRequest(CreateVideoAssignmentRequest());
      !send_status.ok()) {
    LOG(ERROR) << "Failed to send video assignment request: " << send_status;
    return EXIT_FAILURE;
  }
  LOG(INFO) << "Sent video assignment request";

  // Collect media for the specified duration.
  absl::SleepFor(absl::GetFlag(FLAGS_collection_duration));

  if (absl::Status leave_status = client->LeaveConference(/*request_id=*/1);
      !leave_status.ok()) {
    LOG(ERROR) << "Failed to leave conference: " << leave_status;
    return EXIT_FAILURE;
  }
  LOG(INFO) << "Sent leave request";

  // The client may take some time to disconnect since it has to wait for the
  // peer connection to close.
  if (absl::Status disconnect_status =
          media_collector->WaitForDisconnected(absl::Minutes(1));
      !disconnect_status.ok()) {
    LOG(ERROR) << "Failed to disconnect from conference: " << disconnect_status;
    return EXIT_FAILURE;
  }
  LOG(INFO) << "Disconnected from conference";
  return EXIT_SUCCESS;
}

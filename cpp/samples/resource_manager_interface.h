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

#ifndef CPP_SAMPLES_RESOURCE_MANAGER_INTERFACE_H_
#define CPP_SAMPLES_RESOURCE_MANAGER_INTERFACE_H_

#include <cstdint>
#include <string>

#include "absl/status/statusor.h"
#include "absl/time/time.h"
#include "cpp/api/media_entries_resource.h"
#include "cpp/api/participants_resource.h"

namespace media_api_samples {

// Interface for managing conference resources.
//
// In this sample, participant and media entry resources are used to generate
// output file identifiers.
class ResourceManagerInterface {
 public:
  virtual ~ResourceManagerInterface() = default;

  virtual void OnParticipantResourceUpdate(
      const meet::ParticipantsChannelToClient& update,
      absl::Time received_time) = 0;

  virtual void OnMediaEntriesResourceUpdate(
      const meet::MediaEntriesChannelToClient& update,
      absl::Time received_time) = 0;

  // Returns a unique string based on the participant and media entry resources
  // associated with the given contributing source.
  //
  // If sufficient information is not available to construct the identifier,
  // an error is returned.
  virtual absl::StatusOr<std::string> GetOutputFileIdentifier(
      uint32_t contributing_source) = 0;
};

}  // namespace media_api_samples

#endif  // CPP_SAMPLES_RESOURCE_MANAGER_INTERFACE_H_

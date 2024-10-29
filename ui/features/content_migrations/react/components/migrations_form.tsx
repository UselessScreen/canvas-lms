/*
 * Copyright (C) 2023 - present Instructure, Inc.
 *
 * This file is part of Canvas.
 *
 * Canvas is free software: you can redistribute it and/or modify it under
 * the terms of the GNU Affero General Public License as published by the Free
 * Software Foundation, version 3 of the License.
 *
 * Canvas is distributed in the hope that it will be useful, but WITHOUT ANY
 * WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR
 * A PARTICULAR PURPOSE. See the GNU Affero General Public License for more
 * details.
 *
 * You should have received a copy of the GNU Affero General Public License along
 * with this program. If not, see <http://www.gnu.org/licenses/>.
 */

import React, {useEffect, useState, useCallback} from 'react'
import type {SetStateAction, Dispatch} from 'react'
import doFetchApi from '@canvas/do-fetch-api-effect'
import {useScope as useI18nScope} from '@canvas/i18n'
import {showFlashError} from '@canvas/alerts/react/FlashAlert'
import {SimpleSelect} from '@instructure/ui-simple-select'
import {Text} from '@instructure/ui-text'
import {Heading} from '@instructure/ui-heading'
import {View} from '@instructure/ui-view'
import {Alert} from '@instructure/ui-alerts'
import {completeUpload} from '@canvas/upload-file'
import CourseCopyImporter from './migrator_forms/course_copy'
import CanvasCartridgeImporter from './migrator_forms/canvas_cartridge'
import LegacyMigratorWrapper from './migrator_forms/legacy_migrator_wrapper'
import ZipFileImporter from './migrator_forms/zip_file'
import type {
  AttachmentProgressResponse,
  ContentMigrationItem,
  Migrator,
  DateShifts,
  onSubmitMigrationFormCallback,
  AdjustDates,
} from './types'
import CommonCartridgeImporter from './migrator_forms/common_cartridge'
import MoodleZipImporter from './migrator_forms/moodle_zip'
import QTIZipImporter from './migrator_forms/qti_zip'

const I18n = useI18nScope('content_migrations_redesign')

type RequestBody = {
  course_id: string
  migration_type: string
  date_shift_options: DateShifts
  adjust_dates: AdjustDates
  selective_import: boolean
  settings: {[key: string]: any}
  daySubCollection?: object
  errored?: boolean
  pre_attachment?: {
    name: string
    no_redirect: boolean
    size: number
  }
}

type MigratorProps = {
  value: string
  onSubmit: onSubmitMigrationFormCallback
  onCancel: () => void
  fileUploadProgress: number | null
  isSubmitting: boolean
}

const renderMigrator = (props: MigratorProps) => {
  switch (props.value) {
    case 'zip_file_importer':
      return <ZipFileImporter {...props} />
    case 'course_copy_importer':
      props.fileUploadProgress = null
      return <CourseCopyImporter {...props} />
    case 'moodle_converter':
      return <MoodleZipImporter {...props} />
    case 'canvas_cartridge_importer':
      return <CanvasCartridgeImporter {...props} />
    case 'common_cartridge_importer':
      return <CommonCartridgeImporter {...props} />
    case 'qti_converter':
      return <QTIZipImporter {...props} />
    case 'angel_exporter':
    case 'blackboard_exporter':
    case 'd2l_exporter':
      props.fileUploadProgress = null
      return <LegacyMigratorWrapper {...props} />
    default:
      return null
  }
}

/*
  This override is needed to set the default workflow state to 'queued' for the migration,
  because in the StatusPill we want to use the progress workflow state to determine
  the status of the migration. For example course copy create ContentMigration with default
  running state.

  The only exception is when the migration is in the 'waiting_for_select' state, because it cannot
  be represented by the Progress record.
*/
const overrideDefaultWorkflowState = (cm: ContentMigrationItem): ContentMigrationItem => {
  return {
    ...cm,
    workflow_state: cm.workflow_state === 'waiting_for_select' ? cm.workflow_state : 'queued',
  }
}

export const ContentMigrationsForm = ({
  setMigrations,
}: {
  setMigrations: Dispatch<SetStateAction<ContentMigrationItem[]>>
}) => {
  const [migrators, setMigrators] = useState<any>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [chosenMigrator, setChosenMigrator] = useState<string | null>(null)

  const [fileUploadProgress, setFileUploadProgress] = useState<number | null>(null)
  const onResetForm = useCallback(() => {
    setChosenMigrator(null)
    setIsSubmitting(false)
    setFileUploadProgress(0)
  }, [])

  const handleFileProgress = useCallback(
    ({loaded, total}: AttachmentProgressResponse) => {
      setFileUploadProgress(Math.trunc((loaded / total) * 100))
    },
    [setFileUploadProgress]
  )
  const onSubmitForm: onSubmitMigrationFormCallback = useCallback(
    async (formData, preAttachmentFile) => {
      const courseId = window.ENV.COURSE_ID
      if (!chosenMigrator || !courseId || formData.errored) {
        return
      }
      setIsSubmitting(true)
      setFileUploadProgress(0)
      delete formData.errored
      const requestBody: RequestBody = {
        course_id: courseId,
        migration_type: chosenMigrator,
        ...formData,
      }

      const {json} = await doFetchApi({
        method: 'POST',
        path: `/api/v1/courses/${courseId}/content_migrations`,
        body: requestBody,
      })
      if (preAttachmentFile && json.pre_attachment) {
        const attachment = await completeUpload(json.pre_attachment, preAttachmentFile, {
          ignoreResult: true,
          onProgress: (response: any) => {
            handleFileProgress(response)
          },
        })
        const jsonWithAttachment: ContentMigrationItem = {
          ...json,
          attachment,
        }
        onResetForm()
        setMigrations(prevMigrations => [jsonWithAttachment].concat(prevMigrations))
      } else {
        onResetForm()
        const overriddenJson = overrideDefaultWorkflowState(json as ContentMigrationItem)
        setMigrations(prevMigrations => [overriddenJson].concat(prevMigrations))
      }
    },
    [chosenMigrator, handleFileProgress, onResetForm, setMigrations]
  )

  useEffect(() => {
    doFetchApi({
      path: `/api/v1/courses/${window.ENV.COURSE_ID}/content_migrations/migrators`,
    })
      .then((response: {json: Migrator[]}) => {
        // TODO: webct_scraper is not supported anymore, this should be removed from backend too.
        const filteredMigrators = response.json.filter((m: Migrator) => m.type !== 'webct_scraper')
        setMigrators(
          filteredMigrators.sort((a: Migrator, _: Migrator) =>
            a.type === 'course_copy_importer' || a.type === 'canvas_cartridge_importer' ? -1 : 0
          )
        )
      })
      .catch(showFlashError(I18n.t("Couldn't load migrators")))
  }, [])

  return (
    <View as="div" margin="small none xx-large none">
      <Heading level="h2" as="h2" margin="0 0 small">
        {I18n.t('Import Content')}
      </Heading>
      <Text>
        {I18n.t(
          'Use the Import Content tool to migrate course materials from other sources into this course.'
        )}
      </Text>
      <Alert variant="warning">
        {I18n.t(
          'Importing the same course content more than once will overwrite any existing content in the course.'
        )}
      </Alert>
      <hr role="presentation" aria-hidden="true" />
      <View as="div" margin="medium 0" maxWidth="22.5rem">
        {migrators.length > 0 ? (
          <SimpleSelect
            disabled={isSubmitting}
            value={chosenMigrator || 'empty'}
            renderLabel={I18n.t('Select Content Type')}
            onChange={(_e: any, {value}: any) =>
              setChosenMigrator(value !== 'empty' ? value : null)
            }
          >
            <SimpleSelect.Option key="empty-option" id="empty" value="empty">
              {I18n.t('Select one')}
            </SimpleSelect.Option>
            {migrators.map((o: Migrator) => (
              <SimpleSelect.Option key={o.type} id={o.type} value={o.type}>
                {o.name}
              </SimpleSelect.Option>
            ))}
          </SimpleSelect>
        ) : (
          I18n.t('Loading options...')
        )}
      </View>

      {chosenMigrator && (
        <>
          {renderMigrator({
            value: chosenMigrator,
            onSubmit: onSubmitForm,
            onCancel: onResetForm,
            fileUploadProgress,
            isSubmitting,
          })}
          <hr role="presentation" aria-hidden="true" />
        </>
      )}
    </View>
  )
}

export default ContentMigrationsForm

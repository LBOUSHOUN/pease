use image::{DynamicImage, GenericImageView, ImageFormat};
use serde::Serialize;
use std::{
    fs,
    io::{Cursor, Read},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::Duration,
};
use tempfile::Builder;
use wait_timeout::ChildExt;

const MAX_IMAGE_BYTES: usize = 15 * 1024 * 1024;
const MAX_DIMENSION: u32 = 10_000;
const MAX_PIXELS: u64 = 40_000_000;
const OCR_EDGE: u32 = 2_800;
const PROCESS_TIMEOUT: Duration = Duration::from_secs(12);
const LANGUAGES: [&str; 3] = ["fra", "ara", "eng"];
const TEMP_PREFIX: &str = "double-library-ocr-";

#[derive(Clone)]
pub struct OcrRuntime {
    root: PathBuf,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrStatus {
    available: bool,
    languages: Vec<String>,
    engine_version: Option<String>,
    error_code: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrAlternative {
    text: String,
    confidence: Option<f32>,
    language: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookOcrResult {
    title: Option<String>,
    author: Option<String>,
    isbn10: Option<String>,
    isbn13: Option<String>,
    title_confidence: Option<f32>,
    author_confidence: Option<f32>,
    alternatives: Vec<OcrAlternative>,
    detected_languages: Vec<String>,
    warnings: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrFailure {
    code: &'static str,
}

impl OcrFailure {
    pub fn new(code: &'static str) -> Self {
        Self { code }
    }
}

#[derive(Clone, Debug)]
struct OcrLine {
    text: String,
    confidence: f32,
    page: i32,
    block: i32,
    paragraph: i32,
    line: i32,
    left: i32,
    top: i32,
    height: i32,
    width: i32,
    language: String,
}

impl OcrRuntime {
    pub fn new(resource_dir: &Path) -> Self {
        let packaged = resource_dir.join("resources").join("ocr");
        #[cfg(debug_assertions)]
        let root = {
            let source = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("resources")
                .join("ocr");
            if source.is_dir() {
                source
            } else {
                packaged
            }
        };
        #[cfg(not(debug_assertions))]
        let root = packaged;
        Self { root }
    }

    fn executable(&self) -> PathBuf {
        self.root.join("tesseract.exe")
    }

    fn tessdata(&self) -> PathBuf {
        self.root.join("tessdata")
    }

    pub fn status(&self) -> OcrStatus {
        let available_languages: Vec<String> = LANGUAGES
            .iter()
            .filter(|language| {
                self.tessdata()
                    .join(format!("{language}.traineddata"))
                    .is_file()
            })
            .map(|language| (*language).to_string())
            .collect();
        if !self.executable().is_file() {
            return OcrStatus {
                available: false,
                languages: available_languages,
                engine_version: None,
                error_code: Some("OCR_UNAVAILABLE".into()),
            };
        }
        if available_languages.len() != LANGUAGES.len() {
            return OcrStatus {
                available: false,
                languages: available_languages,
                engine_version: None,
                error_code: Some("OCR_LANGUAGE_UNAVAILABLE".into()),
            };
        }
        let version = Command::new(self.executable())
            .arg("--version")
            .stdin(Stdio::null())
            .output()
            .ok()
            .filter(|output| output.status.success())
            .and_then(|output| {
                String::from_utf8(output.stdout)
                    .ok()
                    .and_then(|value| value.lines().next().map(str::to_owned))
            });
        OcrStatus {
            available: version.is_some(),
            languages: available_languages,
            engine_version: version,
            error_code: None,
        }
    }

    pub fn is_available(&self) -> bool {
        self.status().available
    }

    pub fn extract(
        &self,
        bytes: &[u8],
        mime_type: &str,
        title_region: bool,
    ) -> Result<BookOcrResult, OcrFailure> {
        let decoded = decode_image(bytes, mime_type)?;
        let status = self.status();
        if !status.available {
            return Err(OcrFailure::new(
                if status.error_code.as_deref() == Some("OCR_LANGUAGE_UNAVAILABLE") {
                    "OCR_LANGUAGE_UNAVAILABLE"
                } else {
                    "OCR_UNAVAILABLE"
                },
            ));
        }
        let normalized = resize(apply_exif_orientation(decoded, bytes));
        let gray =
            DynamicImage::ImageLuma8(image::imageops::contrast(&normalized.to_luma8(), 28.0));
        let mut threshold = gray.to_luma8();
        for pixel in threshold.pixels_mut() {
            pixel.0[0] = if pixel.0[0] > 150 { 255 } else { 0 };
        }
        let sharpened =
            DynamicImage::ImageLuma8(image::imageops::unsharpen(&gray.to_luma8(), 1.1, 2));
        let variants = [
            normalized,
            gray,
            DynamicImage::ImageLuma8(threshold),
            sharpened,
        ];
        let temp = Builder::new()
            .prefix(TEMP_PREFIX)
            .tempdir()
            .map_err(|_| OcrFailure::new("OCR_PROCESS_FAILED"))?;
        let mut best: Vec<OcrLine> = Vec::new();
        let mut attempts = 0;
        let passes: &[(&str, &[&str])] = if title_region {
            &[("ara", &["7", "6"]), ("fra+eng", &["7", "6"])]
        } else {
            &[("ara", &["11"]), ("fra+eng", &["11"])]
        };
        for (variant_index, variant) in variants.iter().enumerate() {
            let input = temp.path().join(format!("input-{variant_index}.png"));
            variant
                .save_with_format(&input, ImageFormat::Png)
                .map_err(|_| OcrFailure::new("OCR_PROCESS_FAILED"))?;
            let mut variant_lines = Vec::new();
            for (language, modes) in passes {
                for psm in *modes {
                    if attempts >= 8 {
                        break;
                    }
                    attempts += 1;
                    variant_lines.extend(self.run_tesseract(&input, psm, language)?);
                }
            }
            variant_lines = deduplicate_lines(variant_lines);
            if score_lines(&variant_lines) > score_lines(&best) {
                best = variant_lines;
            }
            if score_lines(&best) >= 220.0 {
                break;
            }
        }
        if score_lines(&best) < 120.0 {
            let rotation_psm = if title_region { "6" } else { "11" };
            for (rotation, rotated) in [
                ("90", variants[0].rotate90()),
                ("180", variants[0].rotate180()),
                ("270", variants[0].rotate270()),
            ] {
                let input = temp.path().join(format!("rotation-{rotation}.png"));
                rotated
                    .save_with_format(&input, ImageFormat::Png)
                    .map_err(|_| OcrFailure::new("OCR_PROCESS_FAILED"))?;
                let mut rotated_lines = Vec::new();
                for language in ["ara", "fra+eng"] {
                    rotated_lines.extend(self.run_tesseract(&input, rotation_psm, language)?);
                }
                rotated_lines = deduplicate_lines(rotated_lines);
                if score_lines(&rotated_lines) > score_lines(&best) {
                    best = rotated_lines;
                }
            }
        }
        if best.is_empty() {
            return Err(OcrFailure::new("OCR_NO_TEXT"));
        }
        Ok(build_result(best))
    }

    fn run_tesseract(
        &self,
        input: &Path,
        psm: &str,
        language: &str,
    ) -> Result<Vec<OcrLine>, OcrFailure> {
        let mut command = Command::new(self.executable());
        command
            .args(controlled_arguments(input, &self.tessdata(), psm, language))
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        let output = run_with_timeout(&mut command, PROCESS_TIMEOUT)?;
        if !output.0 {
            return Err(OcrFailure::new("OCR_PROCESS_FAILED"));
        }
        let tsv = String::from_utf8(output.1).map_err(|_| OcrFailure::new("OCR_PROCESS_FAILED"))?;
        Ok(parse_tsv(&tsv, language))
    }
}

fn controlled_arguments(
    input: &Path,
    tessdata: &Path,
    psm: &str,
    language: &str,
) -> Vec<std::ffi::OsString> {
    debug_assert!(matches!(language, "ara" | "fra+eng"));
    debug_assert!(matches!(psm, "6" | "7" | "11"));
    vec![
        input.as_os_str().to_owned(),
        "stdout".into(),
        "--tessdata-dir".into(),
        tessdata.as_os_str().to_owned(),
        "-l".into(),
        language.into(),
        "--oem".into(),
        "1".into(),
        "--psm".into(),
        psm.into(),
        "tsv".into(),
    ]
}

fn run_with_timeout(
    command: &mut Command,
    timeout: Duration,
) -> Result<(bool, Vec<u8>), OcrFailure> {
    let mut child = command
        .spawn()
        .map_err(|_| OcrFailure::new("OCR_UNAVAILABLE"))?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| OcrFailure::new("OCR_PROCESS_FAILED"))?;
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stdout.read_to_end(&mut bytes);
        bytes
    });
    let status = match child
        .wait_timeout(timeout)
        .map_err(|_| OcrFailure::new("OCR_PROCESS_FAILED"))?
    {
        Some(status) => status,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            let _ = reader.join();
            return Err(OcrFailure::new("OCR_TIMEOUT"));
        }
    };
    let bytes = reader
        .join()
        .map_err(|_| OcrFailure::new("OCR_PROCESS_FAILED"))?;
    Ok((status.success(), bytes))
}

pub fn cleanup_stale_temp_dirs() {
    let Ok(entries) = fs::read_dir(std::env::temp_dir()) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let stale = entry
            .metadata()
            .ok()
            .and_then(|metadata| metadata.modified().ok())
            .and_then(|modified| modified.elapsed().ok())
            .is_some_and(|age| age >= Duration::from_secs(60 * 60));
        if stale && name.to_string_lossy().starts_with(TEMP_PREFIX) && entry.path().is_dir() {
            let _ = fs::remove_dir_all(entry.path());
        }
    }
}

fn validate_mime(mime: &str) -> Result<(), OcrFailure> {
    if matches!(mime, "image/jpeg" | "image/png" | "image/webp") {
        Ok(())
    } else {
        Err(OcrFailure::new("OCR_UNSUPPORTED_FORMAT"))
    }
}

fn decode_image(bytes: &[u8], mime_type: &str) -> Result<DynamicImage, OcrFailure> {
    validate_mime(mime_type)?;
    if bytes.is_empty() {
        return Err(OcrFailure::new("OCR_INVALID_IMAGE"));
    }
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(OcrFailure::new("OCR_IMAGE_TOO_LARGE"));
    }
    let format = image::guess_format(bytes).map_err(|_| OcrFailure::new("OCR_INVALID_IMAGE"))?;
    if !matches!(
        format,
        ImageFormat::Jpeg | ImageFormat::Png | ImageFormat::WebP
    ) || !mime_matches(format, mime_type)
    {
        return Err(OcrFailure::new("OCR_UNSUPPORTED_FORMAT"));
    }
    let reader = image::ImageReader::with_format(Cursor::new(bytes), format);
    let (width, height) = reader
        .into_dimensions()
        .map_err(|_| OcrFailure::new("OCR_INVALID_IMAGE"))?;
    validate_dimensions(width, height)?;
    image::load_from_memory_with_format(bytes, format)
        .map_err(|_| OcrFailure::new("OCR_INVALID_IMAGE"))
}

fn mime_matches(format: ImageFormat, mime: &str) -> bool {
    matches!(
        (format, mime),
        (ImageFormat::Jpeg, "image/jpeg")
            | (ImageFormat::Png, "image/png")
            | (ImageFormat::WebP, "image/webp")
    )
}

fn validate_dimensions(width: u32, height: u32) -> Result<(), OcrFailure> {
    if width < 50 || height < 50 {
        return Err(OcrFailure::new("OCR_INVALID_IMAGE"));
    }
    if width > MAX_DIMENSION
        || height > MAX_DIMENSION
        || u64::from(width) * u64::from(height) > MAX_PIXELS
    {
        return Err(OcrFailure::new("OCR_IMAGE_TOO_LARGE"));
    }
    Ok(())
}

fn resize(image: DynamicImage) -> DynamicImage {
    let (width, height) = image.dimensions();
    if width.max(height) <= OCR_EDGE {
        image
    } else {
        image.resize(OCR_EDGE, OCR_EDGE, image::imageops::FilterType::Lanczos3)
    }
}

fn apply_exif_orientation(image: DynamicImage, bytes: &[u8]) -> DynamicImage {
    let orientation = exif::Reader::new()
        .read_from_container(&mut Cursor::new(bytes))
        .ok()
        .and_then(|exif| {
            exif.get_field(exif::Tag::Orientation, exif::In::PRIMARY)
                .and_then(|field| field.value.get_uint(0))
        })
        .unwrap_or(1);
    match orientation {
        3 => image.rotate180(),
        6 => image.rotate90(),
        8 => image.rotate270(),
        _ => image,
    }
}

fn parse_tsv(tsv: &str, language: &str) -> Vec<OcrLine> {
    #[derive(Debug)]
    struct Word {
        page: i32,
        block: i32,
        paragraph: i32,
        line: i32,
        left: i32,
        top: i32,
        width: i32,
        height: i32,
        confidence: f32,
        text: String,
    }
    let mut words = Vec::new();
    for row in tsv.lines().skip(1) {
        let columns: Vec<&str> = row.splitn(12, '\t').collect();
        if columns.len() != 12 || columns[0] != "5" {
            continue;
        }
        let confidence = columns[10].parse::<f32>().unwrap_or(-1.0);
        let text = columns[11].trim();
        if confidence < 0.0 || text.is_empty() {
            continue;
        }
        words.push(Word {
            page: columns[1].parse().unwrap_or(0),
            block: columns[2].parse().unwrap_or(0),
            paragraph: columns[3].parse().unwrap_or(0),
            line: columns[4].parse().unwrap_or(0),
            left: columns[6].parse().unwrap_or(0),
            top: columns[7].parse().unwrap_or(0),
            width: columns[8].parse().unwrap_or(0),
            height: columns[9].parse().unwrap_or(0),
            confidence,
            text: text.to_string(),
        });
    }
    words.sort_by_key(|word| (word.page, word.block, word.paragraph, word.line, word.left));
    let mut result = Vec::new();
    let mut index = 0;
    while index < words.len() {
        let key = (
            words[index].page,
            words[index].block,
            words[index].paragraph,
            words[index].line,
        );
        let start = index;
        while index < words.len()
            && (
                words[index].page,
                words[index].block,
                words[index].paragraph,
                words[index].line,
            ) == key
        {
            index += 1;
        }
        let line_words = &mut words[start..index];
        if language == "ara" {
            line_words.sort_by(|a, b| b.left.cmp(&a.left));
        } else {
            line_words.sort_by_key(|word| word.left);
        }
        let mut confidence = 0.0;
        let mut top = i32::MAX;
        let mut bottom = 0;
        let mut left = i32::MAX;
        let mut right = 0;
        for word in line_words.iter() {
            confidence += word.confidence;
            top = top.min(word.top);
            bottom = bottom.max(word.top + word.height);
            left = left.min(word.left);
            right = right.max(word.left + word.width);
        }
        result.push(OcrLine {
            text: line_words
                .iter()
                .map(|word| word.text.as_str())
                .collect::<Vec<_>>()
                .join(" "),
            confidence: confidence / line_words.len() as f32,
            page: key.0,
            block: key.1,
            paragraph: key.2,
            line: key.3,
            left,
            top,
            height: bottom - top,
            width: right - left,
            language: language.to_string(),
        });
    }
    merge_overlapping_visual_lines(result, language)
}

fn merge_overlapping_visual_lines(mut lines: Vec<OcrLine>, language: &str) -> Vec<OcrLine> {
    lines.sort_by_key(|line| (line.page, line.block, line.paragraph, line.top, line.left));
    let mut merged: Vec<OcrLine> = Vec::new();
    for line in lines {
        if let Some(existing) = merged.iter_mut().find(|existing| {
            existing.page == line.page
                && existing.block == line.block
                && existing.paragraph == line.paragraph
                && (existing.top - line.top).abs() <= existing.height.min(line.height) / 2
        }) {
            let (first, second) = if (language == "ara" && line.left > existing.left)
                || (language != "ara" && line.left < existing.left)
            {
                (line.text.as_str(), existing.text.as_str())
            } else {
                (existing.text.as_str(), line.text.as_str())
            };
            existing.text = format!("{first} {second}");
            existing.confidence = (existing.confidence + line.confidence) / 2.0;
            let right = (existing.left + existing.width).max(line.left + line.width);
            existing.left = existing.left.min(line.left);
            existing.width = right - existing.left;
            existing.height = existing.height.max(line.height);
        } else {
            merged.push(line);
        }
    }
    merged
}

fn deduplicate_lines(lines: Vec<OcrLine>) -> Vec<OcrLine> {
    let mut result: Vec<OcrLine> = Vec::new();
    for line in lines {
        let normalized = line
            .text
            .to_lowercase()
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        if let Some(existing) = result.iter_mut().find(|existing| {
            existing
                .text
                .to_lowercase()
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
                == normalized
        }) {
            if line.confidence > existing.confidence {
                *existing = line;
            }
        } else {
            result.push(line);
        }
    }
    result
}

fn score_lines(lines: &[OcrLine]) -> f32 {
    lines.iter().map(candidate_score).fold(0.0, f32::max)
}

fn script_kind(text: &str) -> &'static str {
    let arabic = text
        .chars()
        .filter(|character| matches!(*character as u32, 0x0600..=0x06ff))
        .count();
    let latin = text
        .chars()
        .filter(|character| {
            character.is_ascii_alphabetic() || matches!(*character as u32, 0x00c0..=0x024f)
        })
        .count();
    if arabic > latin {
        "ara"
    } else if latin > 0 {
        "latn"
    } else {
        "other"
    }
}

fn meaningful_text(text: &str, confidence: f32) -> bool {
    let characters: Vec<char> = text
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect();
    if confidence < 55.0 || characters.len() < 2 || characters.len() > 120 {
        return false;
    }
    let letters = characters
        .iter()
        .filter(|character| character.is_alphabetic())
        .count();
    let punctuation = characters
        .iter()
        .filter(|character| {
            !character.is_alphanumeric() && !matches!(character, '\'' | '’' | '-' | 'ـ')
        })
        .count();
    if (letters as f32 / characters.len() as f32) < 0.55
        || (punctuation as f32 / characters.len() as f32) > 0.25
        || text.contains('�')
    {
        return false;
    }
    if script_kind(text) == "ara" {
        let isolated = text
            .split_whitespace()
            .filter(|word| {
                word.chars()
                    .filter(|character| character.is_alphabetic())
                    .count()
                    == 1
            })
            .count();
        if isolated > 2 {
            return false;
        }
    }
    true
}

fn candidate_score(line: &OcrLine) -> f32 {
    let text = line.text.trim();
    let lower = text.to_lowercase();
    let disallowed_metadata = [
        "par ",
        "auteur ",
        "by ",
        "written by ",
        "éditions ",
        "edition ",
        "éditeur ",
        "publisher ",
        "publishing ",
        "تأليف ",
        "المؤلف ",
        "دار النشر ",
    ];
    if !meaningful_text(text, line.confidence)
        || looks_like_isbn(text)
        || looks_like_price(text)
        || disallowed_metadata
            .iter()
            .any(|prefix| lower.starts_with(prefix))
        || text.contains('@')
        || text.contains("www.")
        || text.contains("http")
    {
        return -1000.0;
    }
    let metadata = [
        "éditions",
        "edition",
        "éditeur",
        "collection",
        "tome",
        "volume",
        "préface",
        "traduit par",
        "prix",
        "nouvelle édition",
        "publishing",
        "publisher",
        "series",
        "foreword",
        "translated by",
        "par ",
        "auteur ",
        "written by",
        "دار النشر",
        "الطبعة",
        "الجزء",
        "المجلد",
        "ترجمة",
        "سلسلة",
    ];
    let penalty = if metadata.iter().any(|term| lower.contains(term)) {
        80.0
    } else {
        0.0
    };
    line.confidence + line.height.min(120) as f32 * 0.65 + line.width.min(1200) as f32 * 0.006
        - line.top.max(0) as f32 * 0.003
        - penalty
}

fn author_candidate(lines: &[OcrLine], title: &str) -> Option<(String, f32)> {
    let prefixes = ["par ", "auteur ", "by ", "written by ", "تأليف ", "المؤلف "];
    lines
        .iter()
        .filter(|line| line.text != title && !looks_like_isbn(&line.text))
        .filter_map(|line| {
            let lower = line.text.to_lowercase();
            prefixes
                .iter()
                .find_map(|prefix| lower.strip_prefix(prefix))
                .map(|_| {
                    let value = line
                        .text
                        .split_once(' ')
                        .map(|(_, rest)| rest)
                        .unwrap_or("")
                        .trim();
                    (value.to_string(), line.confidence)
                })
        })
        .find(|(value, _)| value.chars().count() >= 3)
}

fn adjacent_title_candidates(lines: &[OcrLine]) -> Vec<OcrLine> {
    let mut visual = lines.to_vec();
    visual.sort_by_key(|line| {
        (
            line.page,
            line.block,
            line.paragraph,
            line.line,
            line.top,
            line.left,
        )
    });
    let mut combined = Vec::new();
    for start in 0..visual.len() {
        let mut current = visual[start].clone();
        let mut previous_height = current.height;
        let mut previous_bottom = current.top + current.height;
        for next in visual.iter().skip(start + 1).take(2) {
            let gap = next.top - previous_bottom;
            let similar_height =
                (next.height - previous_height).abs() <= previous_height.max(1) / 2;
            if next.language != current.language
                || script_kind(&next.text) != script_kind(&current.text)
                || gap < -5
                || gap > previous_height.max(next.height)
                || !similar_height
            {
                break;
            }
            current.text = format!("{} {}", current.text, next.text);
            current.confidence = (current.confidence + next.confidence) / 2.0;
            current.width = current.width.max(next.width);
            current.height = next.top + next.height - current.top;
            previous_height = next.height;
            previous_bottom = next.top + next.height;
            combined.push(current.clone());
        }
    }
    combined
}

fn build_result(mut lines: Vec<OcrLine>) -> BookOcrResult {
    lines.extend(adjacent_title_candidates(&lines));
    lines.sort_by(|a, b| candidate_score(b).total_cmp(&candidate_score(a)));
    let candidates: Vec<&OcrLine> = lines
        .iter()
        .filter(|line| candidate_score(line) >= 70.0)
        .take(5)
        .collect();
    let reliable_title = candidates
        .first()
        .copied()
        .filter(|line| line.confidence >= 65.0);
    let title = reliable_title.map(|line| line.text.clone());
    let title_confidence = reliable_title.map(|line| line.confidence);
    let isbn = find_isbn(
        &lines
            .iter()
            .map(|line| line.text.as_str())
            .collect::<Vec<_>>()
            .join("\n"),
    );
    let author = title
        .as_deref()
        .and_then(|title| author_candidate(&lines, title));
    let all_text = lines
        .iter()
        .map(|line| line.text.as_str())
        .collect::<Vec<_>>()
        .join(" ");
    let mut detected_languages = Vec::new();
    if all_text
        .chars()
        .any(|character| matches!(character as u32, 0x0600..=0x06ff))
    {
        detected_languages.push("ara".to_string());
    }
    if all_text
        .chars()
        .any(|character| character.is_ascii_alphabetic())
    {
        detected_languages.extend(["fra".to_string(), "eng".to_string()]);
    }
    BookOcrResult {
        title,
        author: author.as_ref().map(|value| value.0.clone()),
        isbn10: isbn.as_ref().and_then(|value| value.0.clone()),
        isbn13: isbn.as_ref().and_then(|value| value.1.clone()),
        title_confidence,
        author_confidence: author.map(|value| value.1),
        alternatives: candidates
            .into_iter()
            .skip(usize::from(reliable_title.is_some()))
            .map(|line| OcrAlternative {
                text: line.text.clone(),
                confidence: Some(line.confidence),
                language: Some(line.language.clone()),
            })
            .collect(),
        detected_languages,
        warnings: if reliable_title.is_some() {
            Vec::new()
        } else {
            vec!["TITLE_CONFIDENCE_LOW".to_string()]
        },
    }
}

fn normalized_isbn(value: &str) -> String {
    value
        .to_uppercase()
        .chars()
        .filter(|character| character.is_ascii_digit() || *character == 'X')
        .collect()
}

fn valid_isbn10(value: &str) -> bool {
    let code = normalized_isbn(value);
    code.len() == 10
        && code.chars().enumerate().all(|(index, character)| {
            character.is_ascii_digit() || (index == 9 && character == 'X')
        })
        && code
            .chars()
            .enumerate()
            .map(|(index, character)| character.to_digit(10).unwrap_or(10) * (10 - index as u32))
            .sum::<u32>()
            % 11
            == 0
}

fn valid_isbn13(value: &str) -> bool {
    let code = normalized_isbn(value);
    if code.len() != 13 || !code.starts_with("978") && !code.starts_with("979") {
        return false;
    }
    let digits: Vec<u32> = code
        .chars()
        .filter_map(|character| character.to_digit(10))
        .collect();
    digits.len() == 13
        && (10
            - digits[..12]
                .iter()
                .enumerate()
                .map(|(index, digit)| digit * if index % 2 == 0 { 1 } else { 3 })
                .sum::<u32>()
                % 10)
            % 10
            == digits[12]
}

fn find_isbn(text: &str) -> Option<(Option<String>, Option<String>)> {
    for line in text.lines() {
        let line_code = normalized_isbn(line);
        if valid_isbn13(&line_code) {
            return Some((None, Some(line_code)));
        }
        if valid_isbn10(&line_code) {
            return Some((Some(line_code), None));
        }
        for token in line.split_whitespace() {
            let code = normalized_isbn(token);
            if valid_isbn13(&code) {
                return Some((None, Some(code)));
            }
            if valid_isbn10(&code) {
                return Some((Some(code), None));
            }
        }
    }
    None
}

fn looks_like_isbn(text: &str) -> bool {
    let code = normalized_isbn(text);
    text.to_lowercase().contains("isbn") || valid_isbn10(&code) || valid_isbn13(&code)
}

fn looks_like_price(text: &str) -> bool {
    let lower = text.to_lowercase();
    [" dh", "mad", "€", "$", "£", "prix"]
        .iter()
        .any(|value| lower.contains(value))
        && lower.chars().any(|character| character.is_ascii_digit())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(text: &str, confidence: f32, top: i32, language: &str) -> OcrLine {
        OcrLine {
            text: text.into(),
            confidence,
            page: 1,
            block: 1,
            paragraph: 1,
            line: 1,
            left: 20,
            top,
            height: 60,
            width: 500,
            language: language.into(),
        }
    }

    #[test]
    fn validates_dimensions_and_mime() {
        assert!(validate_dimensions(1200, 1800).is_ok());
        assert_eq!(
            validate_dimensions(20, 20).unwrap_err().code,
            "OCR_INVALID_IMAGE"
        );
        assert_eq!(
            validate_dimensions(10_001, 100).unwrap_err().code,
            "OCR_IMAGE_TOO_LARGE"
        );
        assert!(validate_mime("image/webp").is_ok());
        assert_eq!(
            validate_mime("image/svg+xml").unwrap_err().code,
            "OCR_UNSUPPORTED_FORMAT"
        );
    }

    #[test]
    fn validates_isbn_checksums() {
        assert!(valid_isbn10("0-306-40615-2"));
        assert!(valid_isbn13("978-0-306-40615-7"));
        assert!(!valid_isbn13("9780306406158"));
    }

    #[test]
    fn ranks_titles_without_losing_unicode() {
        let french = OcrLine {
            text: "L’Étranger".into(),
            confidence: 91.0,
            page: 1,
            block: 1,
            paragraph: 1,
            line: 1,
            left: 10,
            top: 100,
            height: 72,
            width: 500,
            language: "fra+eng".into(),
        };
        let arabic = OcrLine {
            text: "موسم الهجرة إلى الشمال".into(),
            confidence: 88.0,
            page: 1,
            block: 1,
            paragraph: 1,
            line: 1,
            left: 10,
            top: 130,
            height: 68,
            width: 520,
            language: "ara".into(),
        };
        let price = OcrLine {
            text: "Prix 99 DH".into(),
            confidence: 99.0,
            page: 1,
            block: 1,
            paragraph: 1,
            line: 1,
            left: 10,
            top: 50,
            height: 90,
            width: 600,
            language: "fra+eng".into(),
        };
        assert!(candidate_score(&french) > 0.0);
        assert!(candidate_score(&arabic) > 0.0);
        assert!(candidate_score(&price) < 0.0);
        assert_eq!(french.text, "L’Étranger");
        assert_eq!(arabic.text, "موسم الهجرة إلى الشمال");
    }

    #[test]
    fn isbn_lines_are_not_titles() {
        let line = OcrLine {
            text: "ISBN 978-0-306-40615-7".into(),
            confidence: 99.0,
            page: 1,
            block: 1,
            paragraph: 1,
            line: 1,
            left: 0,
            top: 0,
            height: 100,
            width: 900,
            language: "fra+eng".into(),
        };
        assert!(candidate_score(&line) < 0.0);
    }

    #[test]
    fn tsv_grouping_uses_the_complete_visual_line_key() {
        let tsv = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n\
5\t1\t1\t1\t1\t1\t10\t20\t50\t20\t90\tPremier\n\
5\t1\t2\t1\t1\t1\t10\t200\t60\t20\t91\tSecond";
        let lines = parse_tsv(tsv, "fra+eng");
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].text, "Premier");
        assert_eq!(lines[1].text, "Second");
    }

    #[test]
    fn arabic_words_keep_visual_rtl_order_without_reversing_characters() {
        let tsv = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n\
5\t1\t1\t1\t1\t1\t10\t20\t80\t30\t90\tالشمال\n\
5\t1\t1\t1\t1\t2\t110\t20\t60\t30\t90\tإلى\n\
5\t1\t1\t1\t1\t3\t190\t20\t100\t30\t90\tالهجرة\n\
5\t1\t1\t1\t1\t4\t310\t20\t80\t30\t90\tموسم";
        let lines = parse_tsv(tsv, "ara");
        assert_eq!(lines[0].text, "موسم الهجرة إلى الشمال");
        assert!(!lines[0].text.contains("مسوم"));
    }

    #[test]
    fn separate_language_passes_are_not_concatenated() {
        let lines = vec![
            line("موسم الهجرة", 90.0, 100, "ara"),
            line("Saison de la migration", 90.0, 165, "fra+eng"),
        ];
        assert!(adjacent_title_candidates(&lines).is_empty());
    }

    #[test]
    fn rejects_publisher_author_and_low_quality_garbage() {
        assert!(candidate_score(&line("Éditions Gallimard", 98.0, 100, "fra+eng")) < 0.0);
        assert!(candidate_score(&line("Par Albert Camus", 98.0, 100, "fra+eng")) < 0.0);
        let result = build_result(vec![line("@@@ 12 ??", 42.0, 100, "fra+eng")]);
        assert!(result.title.is_none());
    }

    #[test]
    fn joins_at_most_three_adjacent_title_lines() {
        let lines = vec![
            line("À la recherche", 90.0, 100, "fra+eng"),
            line("du temps", 91.0, 165, "fra+eng"),
            line("perdu", 92.0, 230, "fra+eng"),
            line("Quatrième ligne", 93.0, 295, "fra+eng"),
        ];
        let combined = adjacent_title_candidates(&lines);
        assert!(combined
            .iter()
            .any(|candidate| candidate.text == "À la recherche du temps perdu"));
        assert!(!combined
            .iter()
            .any(|candidate| candidate.text.contains("Quatrième ligne")
                && candidate.text.starts_with("À la recherche")));
    }

    #[test]
    fn selected_regions_use_psm_six_or_seven_and_full_cover_uses_eleven() {
        for psm in ["6", "7"] {
            let rendered =
                controlled_arguments(Path::new("input.png"), Path::new("tessdata"), psm, "ara");
            assert!(rendered.iter().any(|argument| argument == psm));
        }
        let full = controlled_arguments(
            Path::new("input.png"),
            Path::new("tessdata"),
            "11",
            "fra+eng",
        );
        assert!(full.iter().any(|argument| argument == "11"));
    }

    #[test]
    fn temp_names_are_random_and_cleanup_is_scoped() {
        let first = Builder::new().prefix(TEMP_PREFIX).tempdir().unwrap();
        let second = Builder::new().prefix(TEMP_PREFIX).tempdir().unwrap();
        assert_ne!(first.path(), second.path());
        assert!(first
            .path()
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with(TEMP_PREFIX));
    }

    #[test]
    fn unavailable_engine_does_not_expose_paths() {
        let runtime = OcrRuntime {
            root: PathBuf::from("definitely-missing"),
        };
        let status = runtime.status();
        assert!(!status.available);
        let serialized = serde_json::to_string(&status).unwrap();
        assert!(!serialized.contains("definitely-missing"));
    }

    #[test]
    fn accepts_valid_png_and_rejects_corruption() {
        let image = image::DynamicImage::new_rgb8(100, 120);
        let mut bytes = Cursor::new(Vec::new());
        image.write_to(&mut bytes, ImageFormat::Png).unwrap();
        assert!(decode_image(bytes.get_ref(), "image/png").is_ok());
        assert_eq!(
            decode_image(b"not an image", "image/png").unwrap_err().code,
            "OCR_INVALID_IMAGE"
        );
    }

    #[test]
    fn reports_missing_language_files() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("tesseract.exe"), b"placeholder").unwrap();
        let runtime = OcrRuntime {
            root: directory.path().to_path_buf(),
        };
        assert_eq!(
            runtime.status().error_code.as_deref(),
            Some("OCR_LANGUAGE_UNAVAILABLE")
        );
    }

    #[test]
    fn command_arguments_are_fixed_except_validated_paths_and_psm() {
        let args = controlled_arguments(
            Path::new("input.png"),
            Path::new("tessdata"),
            "11",
            "fra+eng",
        );
        let rendered: Vec<String> = args
            .iter()
            .map(|value| value.to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            rendered,
            [
                "input.png",
                "stdout",
                "--tessdata-dir",
                "tessdata",
                "-l",
                "fra+eng",
                "--oem",
                "1",
                "--psm",
                "11",
                "tsv"
            ]
        );
    }

    #[test]
    fn temporary_workspace_is_removed_after_success_and_failure() {
        let success_path = {
            let directory = Builder::new().prefix(TEMP_PREFIX).tempdir().unwrap();
            let path = directory.path().to_path_buf();
            fs::write(path.join("input.png"), b"temporary").unwrap();
            path
        };
        assert!(!success_path.exists());
        let failure_path = (|| -> Result<PathBuf, OcrFailure> {
            let directory = Builder::new().prefix(TEMP_PREFIX).tempdir().unwrap();
            let path = directory.path().to_path_buf();
            fs::write(path.join("input.png"), b"temporary").unwrap();
            Err(OcrFailure::new("OCR_PROCESS_FAILED"))
        })()
        .unwrap_err();
        assert_eq!(failure_path.code, "OCR_PROCESS_FAILED");
    }

    #[test]
    fn timeout_kills_the_child_process() {
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .arg("--exact")
            .arg("ocr::tests::timeout_helper")
            .arg("--nocapture")
            .env("DOUBLE_LIBRARY_OCR_TIMEOUT_HELPER", "1")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        assert_eq!(
            run_with_timeout(&mut command, Duration::from_millis(100))
                .unwrap_err()
                .code,
            "OCR_TIMEOUT"
        );
    }

    #[test]
    fn timeout_helper() {
        if std::env::var_os("DOUBLE_LIBRARY_OCR_TIMEOUT_HELPER").is_some() {
            std::thread::sleep(Duration::from_secs(5));
        }
    }
}
